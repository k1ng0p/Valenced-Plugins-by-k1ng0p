import {
	ActionSheetActionCreators,
	ActionSheetActionCreatorsModuleId,
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules, lookupModule } from '@valenced/modules/finders'
import {
	withDependencies,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { cloneElement, createElement, isValidElement } from 'react'
import { StyleSheet, View } from 'react-native'
import ReplyModal from './reply-modal'
import SettingsComponent from './settings'
import type { ComponentProps, FC, ReactElement } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

export interface Settings {
	bio: boolean
	copy: boolean
}

const DefaultSettings: Settings = {
	bio: true,
	copy: true,
}

const ALERT_KEY = 'k1ngop.profile-replies'
const CUSTOM_STATUS = 4
const MENU_CLOSE_MS = 350

const VERBS = {
	reply: 'Replied to',
	react: 'Reacted to',
}

type Kind = keyof typeof VERBS

interface Target {
	userId: string
	subject: 'status' | 'bio'
	text: string
}

interface StatusActivity {
	type?: number
	state?: string
	emoji?: { id?: string; name?: string; animated?: boolean } | null
}

interface StatusPillProps {
	customStatusActivity?: StatusActivity
	user?: { id: string }
}

interface BioTextProps {
	bio?: string
	userId?: string
}

type Pill<P> = (
	props: P,
) => ReactElement<{ style?: StyleProp<ViewStyle> }> | null

interface EmojiSelection {
	surrogates?: string
	id?: string
	name?: string
	animated?: boolean
}

interface PresenceStore {
	getActivities(userId: string): StatusActivity[]
}

interface RelationshipStore {
	getFriendIDs(): string[]
}

interface UserStore {
	getUser(id: string): { globalName?: string; username?: string } | undefined
}

interface MessageActions {
	sendMessage(
		channelId: string,
		message: object,
		waitForChannelReady?: boolean,
		extra?: object,
	): Promise<{ ok?: boolean; status?: number; body?: unknown } | undefined>
	receiveMessage(channelId: string, message: object): void
}

interface ChannelActions {
	ensurePrivateChannel(userId: string): Promise<string | { id: string }>
}

interface EmojiPicker {
	openEmojiPickerActionSheet(options: {
		onPressEmoji(selection: EmojiSelection): void
		pickerIntention: number
		reactionType: number
		analyticsObject: string
	}): void
}

// The status bubble offsets itself with its own root style. Keeping that on the
// anchor instead lets the menu open on the visible pill and not on the space around it.
const PLACEMENT_KEYS = new Set([
	'margin',
	'marginLeft',
	'marginRight',
	'marginTop',
	'marginBottom',
	'marginHorizontal',
	'marginVertical',
	'marginStart',
	'marginEnd',
	'position',
	'left',
	'right',
	'top',
	'bottom',
	'alignSelf',
	'transform',
])

// Unicode picks carry `surrogates`, custom ones come as `id`, `name` and `animated`.
// The picker suffixes duplicate emoji names with `~n`, which breaks the mention.
function emojiText({ surrogates, id, name, animated }: EmojiSelection) {
	if (surrogates) return surrogates
	if (id && name)
		return `<${animated ? 'a' : ''}:${name.replace(/~\d+$/, '')}:${id}>`
}

// Server emoji don't render in a quote, so only Unicode emoji are kept.
function statusText({ emoji, state }: StatusActivity) {
	const unicode = emoji && !emoji.id ? (emoji.name ?? '') : ''

	return `${unicode} ${state ?? ''}`.trim().replace(/\r?\n/g, ' ')
}

// Bios pad themselves with invisible characters and blank lines to line up their layout,
// and server emoji don't render in a quote, so both are dropped.
function bioText(bio: string) {
	return bio
		.replace(/<a?:\w+:\d+>/g, '')
		.replace(
			/[\u00A0\u00AD\u115F\u1160\u180E\u200B\u200C\u2060-\u2064\u2800\u3164\uFEFF]/g,
			' ',
		)
		.split(/\r?\n/)
		.map(line => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n')
}

// Exactly what the profile shows, custom emoji included, for copying.
function rawStatus({ emoji, state }: StatusActivity) {
	const emojiText = emoji?.id
		? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
		: emoji?.name

	return [emojiText, state].filter(Boolean).join(' ')
}

// Discord epoch is 2015-01-01
const snowflake = () => (BigInt(Date.now() - 1420070400000) << 22n).toString()

function anchorFor(el: ReturnType<Pill<never>> & object, ref: unknown) {
	const style = (StyleSheet.flatten(el.props.style) ?? {}) as Record<
		string,
		unknown
	>
	const outer: Record<string, unknown> = { alignSelf: 'flex-start' }
	const inner: Record<string, unknown> = {}

	for (const key in style)
		(PLACEMENT_KEYS.has(key) ? outer : inner)[key] = style[key]

	return (
		<View
			ref={ref as never}
			collapsable={false}
			pointerEvents="box-only"
			style={outer}
		>
			{cloneElement(el, { style: inner })}
		</View>
	)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage: storage, plugin }) {
		const enabled = (key: keyof Settings) =>
			storage.cache?.[key] ?? DefaultSettings[key]

		const refs: {
			presence?: PresenceStore
			friends?: RelationshipStore
			messages?: MessageActions
			channels?: ChannelActions
			picker?: EmojiPicker
		} = {}

		cleanup(
			getModules(withProps<PresenceStore>('getActivities'), m => {
				refs.presence ??= m
			}),
			getModules(withProps<RelationshipStore>('getFriendIDs'), m => {
				refs.friends ??= m
			}),
			getModules(
				withProps<MessageActions>('sendMessage', 'receiveMessage'),
				m => {
					refs.messages ??= m
				},
			),
			getModules(withProps<ChannelActions>('ensurePrivateChannel'), m => {
				refs.channels ??= m
			}),
		)

		// Loaded on first use. The picker is found through the modules it sits between.
		function resolvePicker() {
			const { ordered, relative } = withDependencies

			refs.picker ??= lookupModule(
				withDependencies<EmojiPicker>(
					ordered([
						relative(1),
						ActionSheetActionCreatorsModuleId,
						relative(2),
					]),
				).and(withProps('openEmojiPickerActionSheet')),
				{ initialize: true },
			)[0]

			return refs.picker
		}

		const ownerOf = (activity: StatusActivity) =>
			refs.friends
				?.getFriendIDs()
				.find(id =>
					refs.presence
						?.getActivities(id)
						?.some(a => a.type === CUSTOM_STATUS && a === activity),
				)

		const isFriend = (userId: string) =>
			!!refs.friends?.getFriendIDs().includes(userId)

		const nameOf = (userId: string) => {
			const user = (Stores.UserStore as unknown as UserStore).getUser(userId)

			return user?.globalName || user?.username || 'user'
		}

		async function send(target: Target, kind: Kind, body: string) {
			try {
				const { channels, messages } = refs

				if (!channels || !messages)
					throw new Error(
						`Missing Discord module: ${channels ? 'sendMessage' : 'ensurePrivateChannel'}`,
					)

				const dm = await channels.ensurePrivateChannel(target.userId)
				const quote = target.text.replace(/\r?\n/g, '\n> ')
				const res = await messages.sendMessage(
					typeof dm === 'string' ? dm : dm.id,
					{
						content: `> -# *${VERBS[kind]} ${nameOf(target.userId)}'s ${target.subject}*\n> ${quote}\n${body}`,
						tts: false,
						invalidEmojis: [],
						validNonShortcutEmojis: [],
					},
					true,
					{ nonce: snowflake() },
				)

				if (res?.ok === false)
					throw new Error(
						`Send failed (${res.status}): ${JSON.stringify(res.body)}`,
					)

				ToastActionCreators.open(ALERT_KEY, {
					text: kind === 'reply' ? 'Reply sent' : 'Reaction sent',
				})
			} catch (e) {
				plugin.reportError(e)
			}
		}

		function openReply(target: Target) {
			AlertActionCreators.openAlert(
				ALERT_KEY,
				<ReplyModal
					name={nameOf(target.userId)}
					subject={target.subject}
					quote={target.text}
					onCancel={() => AlertActionCreators.dismissAlert(ALERT_KEY)}
					onSend={reply => {
						AlertActionCreators.dismissAlert(ALERT_KEY)
						send(target, 'reply', reply)
					}}
				/>,
			)
		}

		function openReact(target: Target) {
			try {
				const picker = resolvePicker()

				if (!picker) throw new Error('Missing Discord module: emoji picker')

				picker.openEmojiPickerActionSheet({
					onPressEmoji: selection => {
						const emoji = selection && emojiText(selection)

						if (!emoji)
							return ToastActionCreators.open(ALERT_KEY, {
								text: 'This emoji is not supported',
							})

						ActionSheetActionCreators.hideActionSheet()
						send(target, 'react', emoji)
					},
					pickerIntention: 0,
					reactionType: 0,
					analyticsObject: 'Message',
				})
			} catch (e) {
				plugin.reportError(e)
			}
		}

		// Closing the menu hides action sheets, so the picker has to wait for it.
		let pendingReact: ReturnType<typeof setTimeout> | undefined

		cleanup(() => clearTimeout(pendingReact))

		let ReactionIcon: ReturnType<typeof lookupGeneratedIconComponent>
		let ReplyIcon: ReturnType<typeof lookupGeneratedIconComponent>
		let CopyIcon: ReturnType<typeof lookupGeneratedIconComponent>

		function TargetMenu({
			subject,
			text,
			raw,
			userId,
			reply,
			copy,
			children,
		}: {
			subject: Target['subject']
			text: string
			raw: string
			userId?: string
			reply: boolean
			copy: boolean
			children: ComponentProps<typeof Design.ContextMenu>['children']
		}) {
			const target = reply && userId ? { userId, subject, text } : undefined

			// triggerOnTap is missing from ContextMenuProps but supported by the menu.
			const { ContextMenu: Menu } = Design as {
				ContextMenu: FC<
					ComponentProps<typeof Design.ContextMenu> & { triggerOnTap?: boolean }
				>
			}

			ReactionIcon ??= lookupGeneratedIconComponent('ReactionIcon')
			ReplyIcon ??= lookupGeneratedIconComponent('ArrowAngleLeftUpIcon')
			CopyIcon ??= lookupGeneratedIconComponent('CopyIcon')

			return (
				<Menu
					title={userId ? `${nameOf(userId)}'s ${subject}` : `Copy ${subject}`}
					items={[
						...(target
							? [
									{
										label: 'React',
										IconComponent: ReactionIcon,
										action: () => {
											clearTimeout(pendingReact)
											pendingReact = setTimeout(
												() => openReact(target),
												MENU_CLOSE_MS,
											)
										},
									},
									{
										label: 'Reply',
										IconComponent: ReplyIcon,
										action: () => openReply(target),
									},
								]
							: []),
						...(copy
							? [
									{
										label: `Copy ${subject}`,
										IconComponent: CopyIcon,
										action: () => {
											Clipboard.setString(raw)
											ToastActionCreators.open(ALERT_KEY, { text: 'Copied' })
										},
									},
								]
							: []),
					]}
					triggerOnTap
				>
					{children}
				</Menu>
			)
		}

		// Renders the client's own pill inside the menu anchor, like Permission Viewer does with role pills.
		function StatusPillWithMenu({
			Pill,
			...props
		}: StatusPillProps & { Pill: Pill<StatusPillProps> }) {
			const el = Pill(props)
			const activity = props.customStatusActivity
			const userId = props.user?.id ?? (activity && ownerOf(activity))
			const reply = !!userId && isFriend(userId)
			const copy = enabled('copy')

			if (!isValidElement(el) || !activity || !(reply || copy)) return el

			return (
				<TargetMenu
					subject="status"
					text={statusText(activity)}
					raw={rawStatus(activity)}
					userId={userId}
					reply={reply}
					copy={copy}
				>
					{({ ref }) => anchorFor(el, ref)}
				</TargetMenu>
			)
		}

		function BioTextWithMenu({
			Pill,
			...props
		}: BioTextProps & { Pill: Pill<BioTextProps> }) {
			const el = Pill(props)
			const { bio, userId } = props
			const text = bio ? bioText(bio) : ''
			const reply = !!text && !!userId && enabled('bio') && isFriend(userId)
			const copy = enabled('copy')

			if (!isValidElement(el) || !bio || !(reply || copy)) return el

			return (
				<TargetMenu
					subject="bio"
					text={text}
					raw={bio}
					userId={userId}
					reply={reply}
					copy={copy}
				>
					{({ ref }) => (
						<View ref={ref as never} collapsable={false}>
							{el}
						</View>
					)}
				</TargetMenu>
			)
		}

		function patchDefault<P extends object>(
			name: string,
			Wrapper: FC<P & { Pill: Pill<P> }>,
		) {
			cleanup(
				getModules(
					withName<Pill<P>>(name),
					module => {
						const namespace = module as unknown as { default?: Pill<P> }

						if (typeof namespace?.default !== 'function')
							return plugin.reportError(
								new Error(
									`${name} has no default export, the menu cannot be installed.`,
								),
							)

						cleanup(
							instead(
								namespace as { default: Pill<P> },
								'default',
								(args, original) =>
									createElement(Wrapper, {
										...args[0],
										Pill: original,
									} as P & { Pill: Pill<P> }) as ReturnType<Pill<P>>,
							),
						)
					},
					{ returnNamespace: true },
				),
			)
		}

		patchDefault('UserProfileCustomStatusBubble', StatusPillWithMenu)
		patchDefault('BioText', BioTextWithMenu)
	},
	SettingsComponent,
})
