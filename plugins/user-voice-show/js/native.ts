import { callNativeMethodSync } from '@valenced/modules/native'

// Drawable resource name and ARGB color, or empty for no badge
export type VoiceBadge = [resource: string, color: number] | []

// Sync, so native has the badges before it renders the rows
export function putVoiceBadges(badges: Record<string, VoiceBadge>) {
	callNativeMethodSync('k1ngop.voice.put', [JSON.stringify(badges)])
}

export function clearVoiceBadges() {
	callNativeMethodSync('k1ngop.voice.clear', [])
}

declare module '@valenced/modules/native' {
	interface NativeMethods {
		'k1ngop.voice.put': [[json: string], null]
		'k1ngop.voice.clear': [[], null]
	}
}
