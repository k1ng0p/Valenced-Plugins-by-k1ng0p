import { ToastActionCreators } from '@valenced/discord/actions'
import { Dispatcher } from '@valenced/discord/common/flux'
import { ImportTrackerModuleId } from '@valenced/discord/common/import-tracker'
import { LoggerModuleId } from '@valenced/discord/common/logger'
import {
	onFluxEventDispatched,
	Stores,
	withStoreName,
} from '@valenced/discord/flux'
import { lookupModule } from '@valenced/modules/finders'
import {
	withDependencies,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import SettingsComponent from './settings'
import type { DiscordModules } from '@valenced/discord/types'
import type { JsonStorage } from '@valenced/json-storage'
import type { ImageSourcePropType } from 'react-native'

const DEBUG: boolean = false

export interface Settings {
	/** IDs of the users on the watchlist. */
	users: string[]
	/** Also track everyone on the friends list. */
	friends: boolean
	/** Typing, messages and voice in servers. */
	servers: boolean
	/** Typing, messages and voice in DMs and group DMs. */
	dms: boolean
	status: boolean
	/** Playing, listening, watching and competing activities. */
	activity: boolean
	typing: boolean
	messages: boolean
	/** Put the message itself in the toast, not just that one was sent. */
	messageContent: boolean
	voice: boolean
	screenShare: boolean
}

export const DefaultSettings: Settings = {
	users: [],
	friends: true,
	servers: true,
	dms: true,
	status: true,
	activity: false,
	typing: true,
	messages: true,
	messageContent: false,
	voice: true,
	screenShare: true,
}

const ChannelType = { DM: 1, Voice: 2, GroupDM: 3, Stage: 13 } as const

export interface User {
	id: string
	username: string
	globalName?: string | null
	getAvatarURL?(
		guildId?: string | null,
		size?: number,
		canAnimate?: boolean,
	): string | number
}

interface Channel {
	id: string
	type: number
	name?: string
	guild_id?: string | null
	guildId?: string | null
	recipients?: string[]
}

interface Activity {
	type: number
	name: string
	details?: string | null
}

interface PresenceUpdates {
	updates?: {
		user?: { id: string }
		status?: string
		activities?: Activity[]
	}[]
}

interface TypingStart {
	channelId: string
	userId: string
}

interface VoiceStateUpdates {
	voiceStates?: {
		userId: string
		channelId?: string | null
		guildId?: string | null
		selfStream?: boolean
	}[]
}

interface Mention {
	id: string
	username: string
	global_name?: string | null
}

interface MessageCreate {
	channelId: string
	guildId?: string | null
	optimistic?: boolean
	message?: {
		id: string
		content?: string
		author?: { id: string; username: string; global_name?: string | null }
		attachments?: unknown[]
		mentions?: Mention[]
	}
}

const ToastDuration = 5000
const MaxMessageLength = 120
const SnowflakePattern = /^\d{17,20}$/

const ActivityVerbs: Record<number, string> = {
	0: 'playing',
	2: 'listening to',
	3: 'watching',
	5: 'competing in',
}

const StatusLabels: Record<string, string> = {
	online: 'online',
	idle: 'idle',
	dnd: 'on Do Not Disturb',
	offline: 'offline',
	invisible: 'offline',
}

const getUserStore = () =>
	Stores.UserStore as DiscordModules.Flux.Store<{
		getUser(id: string): User | undefined
		getCurrentUser(): User | undefined
	}>

const getChannelStore = () =>
	Stores.ChannelStore as DiscordModules.Flux.Store<{
		getChannel(id: string): Channel | undefined
	}>

const getGuildStore = () =>
	Stores.GuildStore as DiscordModules.Flux.Store<{
		getGuild(id: string): { name: string } | undefined
	}>

const getPresenceStore = () =>
	Stores.PresenceStore as DiscordModules.Flux.Store<{
		getStatus(userId: string): string
		getActivities(userId: string): Activity[]
	}>

const getVoiceStateStore = () =>
	Stores.VoiceStateStore as DiscordModules.Flux.Store<{
		getVoiceStateForUser(
			userId: string,
		): { channelId?: string | null; selfStream?: boolean } | undefined
	}>

const getSelectedChannelStore = () =>
	Stores.SelectedChannelStore as DiscordModules.Flux.Store<{
		getChannelId(): string | undefined
	}>

const getRelationshipStore = () =>
	Stores.RelationshipStore as DiscordModules.Flux.Store<{
		isFriend(userId: string): boolean
	}>

let logger: DiscordModules.Logger
let storage: JsonStorage<Settings>
let reportError: (error: unknown) => void

// What each tracked user was last seen with, so one change toasts once
const statuses = new Map<string, string>()
const activities = new Map<string, Activity[]>()

export const getSettings = () =>
	({ ...DefaultSettings, ...storage.cache }) as Settings

export function isTracked(id: string) {
	const { users, friends } = getSettings()
	return users.includes(id) || (friends && getRelationshipStore().isFriend(id))
}

export function getUserName(id: string) {
	const user = getUserStore().getUser(id)
	return user?.globalName || user?.username || id
}

export function getAvatarSource(id: string): ImageSourcePropType | undefined {
	const avatar = getUserStore().getUser(id)?.getAvatarURL?.(null, 64, false)
	return typeof avatar === 'string' ? { uri: avatar } : avatar
}

type Http = {
	HTTP: { get(options: { url: string }): Promise<{ body?: unknown }> }
}
type ProfileSheet = (props: { userId: string }) => void

let http: Http | undefined
let profileSheet: ProfileSheet | undefined

/** Tracked users Discord hasn't loaded yet have no name or avatar to show. */
export async function loadUser(id: string) {
	try {
		http ??= lookupModule(
			withProps<Http & { post: unknown }>('HTTP', 'post'),
		)[0]
		if (!http) throw new Error('HTTP module not found')

		const { body } = await http.HTTP.get({ url: `/users/${id}` })
		Dispatcher.dispatch({ type: 'USER_UPDATE', user: body })
	} catch (error) {
		reportError(error)
	}
}

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

export function openUserProfile(userId: string) {
	try {
		profileSheet ??= findProfileSheet()
		if (!profileSheet) throw new Error('Profile sheet module not found')

		profileSheet({ userId })
	} catch (error) {
		reportError(error)
	}
}

/** Toasts queue, but one whose key is already on screen is dropped. */
function showToast(
	key: string,
	text: string,
	userId?: string,
	variant?: 'success' | 'critical',
) {
	if (DEBUG) logger.log('toast', Date.now(), key)

	const src =
		userId && getUserStore().getUser(userId)?.getAvatarURL?.(null, 64, false)

	ToastActionCreators.open(`watchlist-${key}`, {
		text,
		variant,
		duration: ToastDuration,
		icon:
			userId && typeof src === 'string'
				? { type: 'avatar', src, alt: getUserName(userId) }
				: undefined,
	})
}

export async function trackUser(userId: string) {
	if (!SnowflakePattern.test(userId)) {
		showToast('invalid', 'Enter a valid user ID', undefined, 'critical')
		return false
	}

	const { users } = getSettings()
	if (users.includes(userId)) {
		showToast(
			`known-${userId}`,
			`${getUserName(userId)} is already on your Watchlist`,
			userId,
		)
		return false
	}

	await storage.set({ ...getSettings(), users: [...users, userId] }, true)
	showToast(
		`added-${userId}`,
		`Added ${getUserName(userId)} to your Watchlist`,
		userId,
		'success',
	)

	return true
}

export async function untrackUser(userId: string) {
	statuses.delete(userId)
	activities.delete(userId)

	const settings = getSettings()
	await storage.set(
		{ ...settings, users: settings.users.filter(id => id !== userId) },
		true,
	)
	showToast(
		`removed-${userId}`,
		`Removed ${getUserName(userId)} from your Watchlist`,
		userId,
	)
}

function describeChannel(channelId: string, fallbackGuildId?: string | null) {
	const channel = getChannelStore().getChannel(channelId)
	if (!channel) return 'a channel'
	if (channel.type === ChannelType.DM) return 'DM'
	if (channel.type === ChannelType.GroupDM) return channel.name || 'Group DM'

	const guildId = channel.guild_id ?? channel.guildId ?? fallbackGuildId
	const guild = guildId ? getGuildStore().getGuild(guildId) : undefined
	if (DEBUG && !guild) logger.log('no guild', channelId, guildId)

	const isVoice =
		channel.type === ChannelType.Voice || channel.type === ChannelType.Stage
	const name = isVoice ? channel.name : `#${channel.name}`
	return guild ? `${guild.name} › ${name}` : name
}

function isChannelEnabled(channelId: string) {
	const { servers, dms } = getSettings()
	const type = getChannelStore().getChannel(channelId)?.type
	return type === ChannelType.DM || type === ChannelType.GroupDM ? dms : servers
}

/** Anything happening in the chat that is already open is visible without a toast. */
const isViewing = (channelId: string) =>
	getSelectedChannelStore().getChannelId() === channelId

function onStatus(userId: string, status: string) {
	// Dispatch hooks run before the store updates, so the store still holds the old status
	const previous = statuses.get(userId) ?? getPresenceStore().getStatus(userId)
	statuses.set(userId, status)
	if (previous === status) return

	showToast(
		`status-${userId}-${status}`,
		`${getUserName(userId)} is now ${StatusLabels[status] ?? status}`,
		userId,
	)
}

const trackedActivities = (list: Activity[] = []) =>
	list.filter(activity => activity.type in ActivityVerbs)

// Spotify and similar report the track as details, so each new track counts as a new activity
const describeActivity = ({ type, name, details }: Activity) =>
	type === 2 && details ? `${details} on ${name}` : name

const startKey = (activity: Activity) =>
	`${activity.type}:${describeActivity(activity)}`

// Stopping goes by the app, so a track change is not a stop
const stopKey = ({ type, name }: Activity) => `${type}:${name}`

function onActivities(userId: string, list: Activity[]) {
	const current = trackedActivities(list)
	const previous =
		activities.get(userId) ??
		trackedActivities(getPresenceStore().getActivities(userId))
	activities.set(userId, current)

	const name = getUserName(userId)

	for (const activity of current) {
		if (previous.some(other => startKey(other) === startKey(activity))) continue

		showToast(
			`activity-${userId}-${startKey(activity)}`,
			`${name} is ${ActivityVerbs[activity.type]} ${describeActivity(activity)}`,
			userId,
		)
	}

	for (const activity of previous) {
		if (current.some(other => stopKey(other) === stopKey(activity))) continue

		showToast(
			`activity-stop-${userId}-${stopKey(activity)}`,
			`${name} stopped ${ActivityVerbs[activity.type]} ${activity.name}`,
			userId,
		)
	}
}

function onPresence({ updates }: PresenceUpdates) {
	const { status, activity } = getSettings()

	for (const update of updates ?? []) {
		const userId = update.user?.id
		if (!userId || !isTracked(userId)) continue

		if (status && update.status) onStatus(userId, update.status)
		if (activity && update.activities) onActivities(userId, update.activities)
	}
}

function onTyping({ channelId, userId }: TypingStart) {
	if (
		!getSettings().typing ||
		!isTracked(userId) ||
		!isChannelEnabled(channelId) ||
		isViewing(channelId)
	)
		return

	if (DEBUG) logger.log('typing', Date.now(), userId, channelId)

	showToast(
		`typing-${userId}-${channelId}`,
		`${getUserName(userId)} is typing in ${describeChannel(channelId)}`,
		userId,
	)
}

function onVoice({ voiceStates }: VoiceStateUpdates) {
	const { voice, screenShare } = getSettings()

	for (const state of voiceStates ?? []) {
		const { userId, channelId } = state
		if (!isTracked(userId)) continue

		// The store still holds the state from before this update
		const previous = getVoiceStateStore().getVoiceStateForUser(userId)
		const inChannel = channelId ?? previous?.channelId
		if (!inChannel || !isChannelEnabled(inChannel) || isViewing(inChannel))
			continue

		const name = getUserName(userId)
		const where = describeChannel(inChannel, state.guildId)

		if (voice) {
			if (!channelId)
				showToast(
					`voice-left-${userId}-${inChannel}`,
					`${name} left voice in ${where}`,
					userId,
				)
			else if (previous?.channelId !== channelId)
				showToast(
					`voice-${userId}-${channelId}`,
					`${name} joined voice in ${where}`,
					userId,
				)
		}

		if (!screenShare || !channelId) continue

		if (state.selfStream && !previous?.selfStream)
			showToast(
				`screen-${userId}-${channelId}`,
				`${name} started screen sharing in ${where}`,
				userId,
			)
		else if (!state.selfStream && previous?.selfStream)
			showToast(
				`screen-stop-${userId}-${channelId}`,
				`${name} stopped screen sharing in ${where}`,
				userId,
			)
	}
}

/** Toasts only hold plain text, so emojis and mentions are spelled out. */
function readable(content: string, mentions: Mention[] = []) {
	return content
		.replace(/<a?:(\w+):\d+>/g, ':$1:')
		.replace(/<@!?(\d+)>/g, (_, id: string) => {
			const user = mentions.find(mention => mention.id === id)
			return `@${getUserStore().getUser(id) ? getUserName(id) : user?.global_name || user?.username || 'user'}`
		})
		.replace(/<@&\d+>/g, '@role')
		.replace(
			/<#(\d+)>/g,
			(_, id: string) =>
				`#${getChannelStore().getChannel(id)?.name ?? 'channel'}`,
		)
}

function onMessage({ channelId, guildId, optimistic, message }: MessageCreate) {
	const author = message?.author
	if (
		!getSettings().messages ||
		optimistic ||
		!author ||
		!isTracked(author.id) ||
		!isChannelEnabled(channelId) ||
		isViewing(channelId)
	)
		return

	const content = getSettings().messageContent
		? readable(message.content?.trim() ?? '', message.mentions).trim()
		: ''
	const preview =
		content.length > MaxMessageLength
			? `${content.slice(0, MaxMessageLength)}...`
			: content
	const where = describeChannel(channelId, guildId)
	const sent = message.attachments?.length
		? 'sent an attachment'
		: 'sent a message'

	const name = getUserStore().getUser(author.id)
		? getUserName(author.id)
		: author.global_name || author.username

	showToast(
		`message-${message.id}`,
		preview ? `${name} in ${where}: ${preview}` : `${name} ${sent} in ${where}`,
		author.id,
	)
}

/** Runs a flux handler without ever blocking the event it observes. */
function observe<T extends object>(handler: (payload: T) => void) {
	return (payload: DiscordModules.Flux.DispatcherPayload & T) => {
		try {
			handler(payload)
		} catch (error) {
			reportError(error)
		}

		return payload
	}
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, logger: pluginLogger, plugin }) {
		storage = jsonStorage
		logger = pluginLogger
		reportError = error => plugin.reportError(error)

		cleanup(
			onFluxEventDispatched<PresenceUpdates>(
				'PRESENCE_UPDATES',
				observe(onPresence),
			),
			onFluxEventDispatched<TypingStart>('TYPING_START', observe(onTyping)),
			onFluxEventDispatched<VoiceStateUpdates>(
				'VOICE_STATE_UPDATES',
				observe(onVoice),
			),
			onFluxEventDispatched<MessageCreate>(
				'MESSAGE_CREATE',
				observe(onMessage),
			),
			() => {
				statuses.clear()
				activities.clear()
			},
		)
	},
	SettingsComponent,
})
