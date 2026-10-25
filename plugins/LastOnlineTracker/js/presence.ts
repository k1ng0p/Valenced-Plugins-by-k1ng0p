import { onFluxEventDispatched, Stores } from '@valenced/discord/flux'
import { getJsonStorage } from '@valenced/json-storage'
import { pluginStorageDirFor } from '@valenced/plugins/constants'
import type { DiscordModules } from '@valenced/discord/types'
import type { JsonStorage } from '@valenced/json-storage'
import type { PluginApi } from '@valenced/plugins/types'

export const Labels = ['Active', 'Last seen', 'Online', 'Seen'] as const
export type Label = (typeof Labels)[number]

export type TimeFormat = 'relative' | 'exact'

export interface Settings {
	label: Label
	timeFormat: TimeFormat
	/** Keeps last-seen times across restarts. */
	persist: boolean
	dmList: boolean
	/** The member list and DM header share one status component, so they share one switch. */
	memberList: boolean
	/** Only track people on the friends list. */
	friendsOnly: boolean
}

export const DefaultSettings: Settings = {
	label: 'Active',
	timeFormat: 'relative',
	persist: true,
	dmList: true,
	memberList: true,
	friendsOnly: false,
}

export type Api = PluginApi<{ jsonStorage: Settings }>

type PresenceStore = DiscordModules.Flux.Store<{
	getStatus(userId: string): string | undefined
}>

type RelationshipStore = DiscordModules.Flux.Store<{
	isFriend(userId: string): boolean
}>

type VoiceStateStore = DiscordModules.Flux.Store<{
	getVoiceStateForUser(userId: string): unknown
}>

interface PresenceUpdate {
	user?: { id: string }
	userId?: string
	status?: string
}

const MaxTracked = 500
const PersistDelay = 1500

const lastSeen = new Map<string, number>()
/** Users seen online since start, so their next offline update is a real transition. */
const online = new Set<string>()

let settings: JsonStorage<Settings>
let storage: JsonStorage<Record<string, number>>
let reportError: (error: unknown) => void
let persistTimer: ReturnType<typeof setTimeout> | undefined

export const getSettings = (): Settings => ({
	...DefaultSettings,
	...settings.cache,
})

function isOffline(userId: string) {
	const status =
		(Stores.PresenceStore as PresenceStore | undefined)?.getStatus(userId) ??
		'online'
	return status === 'offline' || status === 'invisible'
}

export function isInVoice(userId: string) {
	return !!(
		Stores.VoiceStateStore as VoiceStateStore | undefined
	)?.getVoiceStateForUser(userId)
}

function formatRelative(timestamp: number) {
	const seconds = Math.max(0, Date.now() - timestamp) / 1000
	if (seconds < 60) return `${Math.floor(seconds)}s ago`

	const minutes = seconds / 60
	if (minutes < 60) return `${Math.floor(minutes)}m ago`

	const hours = minutes / 60
	if (hours < 24) return `${Math.floor(hours)}h ago`

	const days = hours / 24
	if (days < 7) return `${Math.floor(days)}d ago`

	const date = new Date(timestamp)
	return date.toLocaleDateString([], {
		month: 'short',
		day: 'numeric',
		year:
			date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
	})
}

function formatTime(timestamp: number) {
	return getSettings().timeFormat === 'exact'
		? new Date(timestamp).toLocaleTimeString([], {
				hour: 'numeric',
				minute: '2-digit',
			})
		: formatRelative(timestamp)
}

function isTracked(userId: string) {
	return (
		!getSettings().friendsOnly ||
		!!(Stores.RelationshipStore as RelationshipStore | undefined)?.isFriend(
			userId,
		)
	)
}

/** The text to show for an offline user, or nothing if they're online or were never seen. */
export function getLastSeenLabel(userId: string) {
	if (!isTracked(userId)) return

	if (!isOffline(userId)) {
		online.add(userId)
		return
	}

	const seenAt = lastSeen.get(userId)
	if (seenAt !== undefined)
		return `${getSettings().label} ${formatTime(seenAt)}`
}

function persist() {
	persistTimer = undefined
	storage.set(Object.fromEntries(lastSeen), true).catch(reportError)
}

function markSeen(userId: string) {
	lastSeen.delete(userId)
	lastSeen.set(userId, Date.now())
	if (lastSeen.size > MaxTracked) lastSeen.delete(lastSeen.keys().next().value!)

	if (!getSettings().persist) return
	clearTimeout(persistTimer)
	persistTimer = setTimeout(persist, PersistDelay)
}

export function clearLastSeen() {
	lastSeen.clear()
	return storage.set({}, true)
}

export async function startTracking({ cleanup, jsonStorage, plugin }: Api) {
	settings = jsonStorage
	storage = getJsonStorage(
		`${pluginStorageDirFor(plugin.manifest.id)}/lastseen.json`,
	)
	reportError = error => plugin.reportError(error)

	await settings.get()
	if (getSettings().persist) {
		for (const [userId, timestamp] of Object.entries(await storage.get())) {
			if (typeof timestamp !== 'number' || timestamp <= 0) continue
			lastSeen.set(userId, timestamp)
			if (!isOffline(userId)) online.add(userId)
		}
	}

	cleanup(
		onFluxEventDispatched<{ updates?: PresenceUpdate[] }>(
			'PRESENCE_UPDATES',
			payload => {
				for (const update of payload.updates ?? []) {
					const userId = update.user?.id ?? update.userId
					if (!userId || !update.status || !isTracked(userId)) continue

					if (update.status !== 'offline') online.add(userId)
					else if (online.delete(userId)) markSeen(userId)
				}

				return payload
			},
		),
		() => {
			if (persistTimer) {
				clearTimeout(persistTimer)
				persist()
			}

			lastSeen.clear()
			online.clear()
		},
	)
}
