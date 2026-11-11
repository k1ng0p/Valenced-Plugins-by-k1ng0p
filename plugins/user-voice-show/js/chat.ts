import { getAssetIdByName } from '@valenced/assets'
import { Tokens } from '@valenced/discord/common/tokens'
import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { registerJSMethod } from '@valenced/modules/native'
import { after } from '@valenced/patcher'
import { Image, processColor } from 'react-native'
import { clearVoiceBadges, putVoiceBadges } from './native'
import { GlyphAssets, getJoinableChannelId, getVoiceGlyph } from './voice'
import type { DiscordModules } from '@valenced/discord/types'
import type { VoiceBadge } from './native'
import type { VoiceGlyph } from './voice'

interface RowManager {
	prototype: {
		generate(row: unknown): MessageRow
	}
}

interface MessageRow {
	type?: number
	message?: {
		id: string
		authorId?: string
	}
}

const MessageRowType = 1

const Capacity = 2000

const FallbackColor = '#b5bac1'

const resourceNames = new Map<VoiceGlyph, string | null>()

function resourceName(
	glyph: VoiceGlyph,
	reportError: (error: unknown) => void,
) {
	const known = resourceNames.get(glyph)
	if (known !== undefined) return known

	const assetId = GlyphAssets[glyph]
		.map(name => getAssetIdByName(name, 'png'))
		.find(id => id !== undefined)
	let name: string | null = null

	if (assetId === undefined) {
		reportError(new Error(`No icon asset found for ${glyph}`))
	} else {
		// Bundled assets are drawable resources, the URI is the resource name
		const { uri } = Image.resolveAssetSource(assetId)
		if (/^\w+$/.test(uri)) name = uri
		else reportError(new Error(`Icon of ${glyph} is not a drawable: ${uri}`))
	}

	resourceNames.set(glyph, name)
	return name
}

function iconColor() {
	const token = Tokens.default?.colors?.INTERACTIVE_NORMAL
	const color = typeof token === 'string' ? token : token?.resolve?.()
	return processColor(color ?? FallbackColor) as number
}

export default function patchChat(
	cleanup: (...cleanups: (() => unknown)[]) => void,
	reportError: (error: unknown) => void,
	enabled: () => boolean,
	open: (channelId: string) => void,
) {
	const authors = new Map<string, string>()
	// Message ID to the badge JSON native has
	const sent = new Map<string, string>()

	const push = (ids: string[]) => {
		const updates: Record<string, VoiceBadge> = {}
		const color = iconColor()
		const show = enabled()

		for (const id of ids) {
			const authorId = authors.get(id)
			if (!authorId) continue

			const glyph = show ? getVoiceGlyph(authorId) : undefined
			const resource = glyph && resourceName(glyph, reportError)
			const badge: VoiceBadge = resource ? [resource, color] : []
			const json = JSON.stringify(badge)
			if ((sent.get(id) ?? '[]') === json) continue

			sent.set(id, json)
			updates[id] = badge
		}

		if (Object.keys(updates).length) putVoiceBadges(updates)
	}

	const voiceStates =
		Stores.VoiceStateStore as DiscordModules.Flux.Store<object>
	const onVoiceChange = () => {
		try {
			push([...authors.keys()])
		} catch (e) {
			reportError(e)
		}
	}

	voiceStates.addChangeListener(onVoiceChange)

	let active = true
	registerJSMethod('k1ngop.voice.open', (messageId: string) => {
		const authorId = authors.get(messageId)
		const channelId = active && authorId && getJoinableChannelId(authorId)
		if (channelId) open(channelId)
	})

	cleanup(
		() => {
			active = false
		},
		() => voiceStates.removeChangeListener(onVoiceChange),
		() => clearVoiceBadges(),
		// modules/messages/native/renderer/RowGenerator.tsx
		getModules(withName<RowManager>('RowManager'), ({ prototype }) => {
			cleanup(
				after(prototype, 'generate', row => {
					const message = row?.type === MessageRowType ? row.message : null
					if (!message?.authorId) return row

					try {
						if (!authors.has(message.id)) {
							authors.set(message.id, message.authorId)

							if (authors.size > Capacity) {
								const oldest = authors.keys().next().value as string
								authors.delete(oldest)
								sent.delete(oldest)
							}
						}

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
