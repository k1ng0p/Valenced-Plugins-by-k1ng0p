import type { PluginApi } from '@valenced/plugins/types'

export interface Settings {
	legacyEnabled: boolean
	dmTopBar: boolean
	userList: boolean
	profileUsername: boolean
	fallbackColors: boolean
	experimentalStatusDot: boolean
	dotYouBar: boolean
	statusDotInlineRemaining: boolean
}

export const DefaultSettings: Settings = {
	legacyEnabled: false,
	dmTopBar: false,
	userList: false,
	profileUsername: false,
	fallbackColors: false,
	experimentalStatusDot: true,
	dotYouBar: true,
	statusDotInlineRemaining: true,
}

type Api = PluginApi<{ jsonStorage: Settings }>

let storage: Api['jsonStorage'] | undefined
let plugin: Api['plugin'] | undefined

const reportedErrors = new Set<string>()

export function bindApi(
	jsonStorage: Api['jsonStorage'] | undefined,
	pluginApi: Api['plugin'] | undefined,
) {
	storage = jsonStorage
	plugin = pluginApi
}

export function getSettings(): Settings {
	return { ...DefaultSettings, ...storage?.cache }
}

/** Patched renders run constantly, so each distinct error is reported once. */
export function reportError(error: unknown) {
	const key = error instanceof Error ? error.message : String(error)
	if (reportedErrors.has(key)) return
	reportedErrors.add(key)
	plugin?.reportError(error)
}
