import { bindStorage, DEFAULTS } from './options'
import { installPatches } from './patches'
import SettingsPage from './settings'
import type { Settings } from './options'
import type { Env } from './patches'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DEFAULTS,
	},
	start({ cleanup, jsonStorage, plugin }) {
		bindStorage(jsonStorage)

		const env: Env = { cleanup, fail: e => plugin.reportError(e), live: true }
		cleanup(() => {
			env.live = false
		})
		installPatches(env)

		// Discord caches parsed profile data, so a late start only fully applies after a reload
		if (plugin.startedLate) plugin.requireReload()
	},
	stop() {
		this.requireReload()
	},
	SettingsComponent: SettingsPage,
})
