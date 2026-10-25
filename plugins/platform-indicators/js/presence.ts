import { onFluxEventDispatched, Stores } from '@valenced/discord/flux'
import type { Statuses } from './platforms'

interface Store {
	addChangeListener?(listener: () => void): void
	removeChangeListener(listener: () => void): void
}

const FluxEvents = ['PRESENCE_UPDATES', 'PRESENCES_REPLACE', 'SESSIONS_REPLACE']

const subscribers = new Set<() => void>()
let disconnect: (() => void) | undefined
let queued = false

export function statusSignature(statuses: Statuses | undefined): string {
	return Object.entries(statuses ?? {})
		.map(([platform, status]) => `${platform}:${status}`)
		.join(',')
}

function flush() {
	queued = false
	for (const subscriber of [...subscribers])
		if (subscribers.has(subscriber)) subscriber()
}

function queueFlush() {
	if (queued) return
	queued = true
	setTimeout(flush, 0)
}

function connect() {
	const { PresenceStore, SessionsStore, SelfPresenceStore } = Stores as Record<
		string,
		Store | undefined
	>
	const stores = [PresenceStore, SessionsStore, SelfPresenceStore].filter(
		(store): store is Store => typeof store?.addChangeListener === 'function',
	)
	for (const store of stores) store.addChangeListener?.(queueFlush)

	const offEvents = FluxEvents.map(name =>
		onFluxEventDispatched(name, payload => {
			queueFlush()
			return payload
		}),
	)

	return () => {
		for (const store of stores) store.removeChangeListener(queueFlush)
		for (const off of offEvents) off()
	}
}

export function subscribe(subscriber: () => void) {
	subscribers.add(subscriber)
	disconnect ??= connect()

	return () => {
		subscribers.delete(subscriber)
		if (subscribers.size) return
		disconnect?.()
		disconnect = undefined
	}
}

export function stopPresence() {
	subscribers.clear()
	disconnect?.()
	disconnect = undefined
}
