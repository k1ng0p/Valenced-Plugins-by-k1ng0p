import { ToastActionCreators } from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { ImportTrackerModuleId } from '@valenced/discord/common/import-tracker'
import { LoggerModuleId } from '@valenced/discord/common/logger'
import { Stores, withStoreName } from '@valenced/discord/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	withDependencies,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import type { DiscordModules } from '@valenced/discord/types'

// Both are in intl/index.native.tsx
const NoAccessTitleKey = 'r0DLNm'
const NoAccessBodyKey = 'Fqqbhg'
const SNOWFLAKE = /^\d{17,20}$/

interface Intl {
	intl: { formatToPlainString(message: unknown): string }
	t: Record<string, unknown>
	getAvailableLocales(): unknown
}

type ProfileSheet = (props: { userId: string }) => void

type Alerts = Record<'close' | 'openLazy' | 'confirm', unknown> & {
	show(props: unknown): unknown
}

type Http = {
	HTTP: { get(options: { url: string }): Promise<{ body?: unknown }> }
}

interface Message {
	id: string
	content?: string
}

async function cacheUser(userId: string) {
	http ??= lookupModule(withProps('HTTP', 'post'))[0] as Http | undefined
	if (!http) throw new Error('HTTP module not found')

	const { body } = await http.HTTP.get({ url: `/users/${userId}` })
	Dispatcher.dispatch({ type: 'USER_UPDATE', user: body })
}

const RedrawDelay = 0
const redraws = new Set<ReturnType<typeof setTimeout>>()

// Messages keep the mention they were first rendered with, so the cached user alone changes nothing.
function redrawMentions(userId: string) {
	const SelectedChannelStore =
		Stores.SelectedChannelStore as DiscordModules.Flux.Store<{
			getChannelId(): string | undefined
		}>
	const channelId = SelectedChannelStore.getChannelId()
	if (!channelId) return

	const MessageStore = Stores.MessageStore as DiscordModules.Flux.Store<{
		getMessages(channelId: string): { toArray(): Message[] }
	}>
	const mention = new RegExp(`<@!?${userId}>`)

	for (const { id, content } of MessageStore.getMessages(channelId).toArray()) {
		if (!content || !mention.test(content)) continue

		Dispatcher.dispatch({
			type: 'MESSAGE_UPDATE',
			message: { id, channel_id: channelId, content: `${content}\u200b` },
		})
		const timer = setTimeout(() => {
			redraws.delete(timer)
			Dispatcher.dispatch({
				type: 'MESSAGE_UPDATE',
				message: { id, channel_id: channelId, content },
			})
		}, RedrawDelay)
		redraws.add(timer)
	}
}

let intl: Intl | undefined
let profileSheet: ProfileSheet | undefined
let http: Http | undefined

function findProfileSheet() {
	const named = withName<ProfileSheet>('showUserProfileActionSheet')
	const { ordered, relative } = withDependencies
	const [, UserStoreId] = lookupModule(withStoreName('UserStore'))

	const [exact] = lookupModule(
		named.and(
			withDependencies(
				ordered([
					LoggerModuleId,
					UserStoreId,
					relative(1),
					relative(2),
					relative(3),
					ImportTrackerModuleId,
				]),
			),
		),
	)

	// the exact match depends on Discord's module layout, the name alone is the fallback
	return exact ?? lookupModule(named)[0]
}

function isNoAccessAlert(
	props: unknown,
	{ intl, t }: Intl,
): props is { onConfirmSecondary(): void } {
	return (
		typeof props === 'object' &&
		props !== null &&
		'title' in props &&
		props.title === intl.formatToPlainString(t[NoAccessTitleKey]) &&
		'body' in props &&
		props.body === intl.formatToPlainString(t[NoAccessBodyKey]) &&
		'onConfirmSecondary' in props &&
		typeof props.onConfirmSecondary === 'function'
	)
}

// The alert never receives the ID as a prop, only its "Copy User ID" handler knows it.
// Run that handler with the clipboard write and its toast swallowed to read the ID out.
function readUserId(copyUserId: () => void) {
	let copied: string | undefined
	const restore = [
		instead(Clipboard, 'setString', ([text]: [string]) => {
			copied = text
		}),
		instead(ToastActionCreators, 'open', () => {}),
	]

	try {
		copyUserId()
	} finally {
		for (const undo of restore) undo()
	}

	return copied && SNOWFLAKE.test(copied) ? copied : undefined
}

export default plugin({
	start({ cleanup, plugin }) {
		cleanup(() => {
			for (const timer of redraws) clearTimeout(timer)
			redraws.clear()
		})
		cleanup(
			getModules(
				withProps<Alerts>('show', 'close', 'openLazy', 'confirm'),
				alerts => {
					cleanup(
						instead(alerts, 'show', ([props], orig) => {
							try {
								intl ??= lookupModule(
									withProps<Intl>('intl', 't', 'getAvailableLocales'),
								)[0]
								if (!intl) throw new Error('Intl module not found')

								if (isNoAccessAlert(props, intl)) {
									const userId = readUserId(props.onConfirmSecondary)
									profileSheet ??= findProfileSheet()
									if (userId && profileSheet) {
										profileSheet({ userId })
										cacheUser(userId)
											.then(() => redrawMentions(userId))
											.catch(plugin.reportError)
										return
									}

									plugin.reportError(
										new Error(
											userId
												? 'Profile sheet not found'
												: 'Could not read the user ID from the alert',
										),
									)
								}
							} catch (error) {
								plugin.reportError(error)
							}

							// show reads this.openLazy, so the original needs its receiver back
							return orig.call(alerts, props)
						}),
					)
				},
			),
		)
	},
})