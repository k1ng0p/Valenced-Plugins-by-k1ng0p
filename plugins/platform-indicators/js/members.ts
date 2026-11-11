import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { reportError } from './shared'

interface Dispatcher {
	dispatch(action: { type: string; guildId: string; userIds: string[] }): void
	subscribe?: unknown
}

interface ChannelStore {
	getChannel?(id: string): { guild_id?: string } | null | undefined
}

const SubscribeAction = 'GUILD_SUBSCRIPTIONS_MEMBERS_ADD'

// Guild ID to the users whose presence is yet to be requested
const pending = new Map<string, Set<string>>()
// "guildId:userId" of everyone already requested
const requested = new Set<string>()
let dispatcher: Dispatcher | undefined
let queued = false

function flush() {
	queued = false
	if (!dispatcher) return

	for (const [guildId, users] of pending) {
		try {
			dispatcher.dispatch({
				type: SubscribeAction,
				guildId,
				userIds: [...users],
			})
		} catch (e) {
			reportError(e)
		}
	}
	pending.clear()
}

/** Discord only sends presences of server members it is subscribed to, so author's are asked for. */
export function requestPresence(channelId: string, userId: string) {
	const { ChannelStore } = Stores as Record<string, ChannelStore | undefined>
	const guildId = ChannelStore?.getChannel?.(channelId)?.guild_id
	if (!guildId || requested.has(`${guildId}:${userId}`)) return

	requested.add(`${guildId}:${userId}`)
	let users = pending.get(guildId)
	if (!users) pending.set(guildId, (users = new Set()))
	users.add(userId)

	if (queued) return
	queued = true
	setTimeout(flush, 100)
}

export function connectDispatcher() {
	const disconnect = getModules(withProps<Dispatcher>('dispatch'), mod => {
		if (typeof mod.subscribe === 'function') dispatcher = mod
	})

	return () => {
		disconnect()
		dispatcher = undefined
		pending.clear()
		requested.clear()
	}
}
