import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { Image, processColor } from 'react-native'
import { connectDispatcher, requestPresence } from './members'
import { clearChatIcons, putChatIcons } from './native'
import {
	findAsset,
	getStatuses,
	isStreaming,
	normalizePlatform,
	pickDotPlatform,
	statusColor,
} from './platforms'
import { subscribe } from './presence'
import { getSettings, reportError } from './shared'
import type { ChatIcon, ChatIcons } from './native'

interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

interface MessageRow {
	type?: number
	message?: {
		id: string
		channelId?: string
		authorId?: string
	}
}

const MessageRowType = 1

/** Message rows tracked at once. */
const Capacity = 2000

// Platform to the drawable name of its icon, null when it has none native can use
const resourceNames = new Map<string, string | null>()

function resourceName(platform: string) {
	const key = normalizePlatform(platform)
	const known = resourceNames.get(key)
	if (known !== undefined) return known

	const assetId = findAsset(key, false)
	if (!assetId) return null

	// Bundled assets are drawable resources, and their URI is the resource's name
	const { uri } = Image.resolveAssetSource(assetId)
	if (!/^\w+$/.test(uri)) {
		reportError(
			new Error(`Icon of "${platform}" is not a drawable resource: ${uri}`),
		)
		resourceNames.set(key, null)
		return null
	}

	resourceNames.set(key, uri)
	return uri
}

function iconsOf(userId: string) {
	const statuses = getStatuses(userId) ?? {}
	const streamingPlatform = isStreaming(userId)
		? pickDotPlatform(statuses)
		: null
	const { fallbackColors } = getSettings()
	const icons: ChatIcon[] = []

	for (const [platform, status] of Object.entries(statuses)) {
		const resource = resourceName(platform)
		if (!resource) continue

		const color = processColor(
			statusColor(
				platform === streamingPlatform ? 'streaming' : status,
				fallbackColors,
			),
		)
		if (typeof color === 'number') icons.push([resource, color])
	}

	return icons
}

/** Tells native which platforms the author of each chat message is on, and keeps it up to date. */
export default function patchChat(
	cleanup: (...cleanups: (() => unknown)[]) => void,
) {
	// Message ID to its author
	const authors = new Map<string, string>()
	// Message ID to the icons native was last told about, as JSON
	const sent = new Map<string, string>()
	let nativeFailed = false

	const push = (ids: Iterable<string>) => {
		if (nativeFailed) return

		const updates: ChatIcons = {}
		// The icons of an author are worked out once, however many messages they have
		const byAuthor = new Map<string, ChatIcon[]>()

		for (const id of ids) {
			const authorId = authors.get(id)
			if (!authorId) continue

			let icons = byAuthor.get(authorId)
			if (!icons) byAuthor.set(authorId, (icons = iconsOf(authorId)))

			const json = JSON.stringify(icons)
			if ((sent.get(id) ?? '[]') === json) continue

			sent.set(id, json)
			updates[id] = icons
		}

		if (!Object.keys(updates).length) return

		try {
			putChatIcons(updates)
		} catch (e) {
			// Native has no `put` when its part failed to start, so retrying on every message only repeats it
			nativeFailed = true
			reportError(e)
		}
	}

	const update = () => {
		try {
			push(authors.keys())
		} catch (e) {
			reportError(e)
		}
	}

	cleanup(
		subscribe(update),
		connectDispatcher(),
		() => {
			if (!nativeFailed) clearChatIcons()
		},
		// modules/messages/native/renderer/RowGenerator.tsx
		getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
			cleanup(
				after(prototype, 'generate', row => {
					const message = row?.type === MessageRowType ? row.message : null
					if (!message?.authorId) return row
					if (!getSettings().chatIcons) return row

					try {
						if (!authors.has(message.id)) {
							authors.set(message.id, message.authorId)

							if (authors.size > Capacity) {
								const oldest = authors.keys().next().value as string
								authors.delete(oldest)
								sent.delete(oldest)
							}
						}

						if (message.channelId)
							requestPresence(message.channelId, message.authorId)
						push([message.id])
					} catch (e) {
						reportError(e)
					}

					return row
				}),
			)
		}),
	)
}
