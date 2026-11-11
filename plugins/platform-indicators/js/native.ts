import { callNativeMethodSync } from '@valenced/modules/native'

/** A platform's icon as the name of its drawable resource, and its ARGB color. */
export type ChatIcon = [resource: string, color: number]

/** Message ID to the icons native shows next to its author. An empty list shows none. */
export type ChatIcons = Record<string, ChatIcon[]>

/** Synchronous so the icons are stored before the rows that show them reach native. */
export function putChatIcons(icons: ChatIcons) {
	callNativeMethodSync('k1ngop.platformindicators.put', [JSON.stringify(icons)])
}

export function clearChatIcons() {
	callNativeMethodSync('k1ngop.platformindicators.clear', [])
}

declare module '@valenced/modules/native' {
	interface NativeMethods {
		'k1ngop.platformindicators.put': [[json: string], null]
		'k1ngop.platformindicators.clear': [[], null]
	}
}
