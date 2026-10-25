import { patchLastSeen } from './patches'
import { DefaultSettings, startTracking } from './presence'
import SettingsComponent from './settings'
import type { Settings } from './presence'

/** Discord caches rendered rows, so these only apply cleanly after a reload. */
const ReloadKeys = ['dmList', 'memberList', 'friendsOnly'] as const

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	async start(api) {
		await startTracking(api)
		patchLastSeen(api)

		api.cleanup(
			api.jsonStorage.subscribe(update => {
				if (ReloadKeys.some(key => key in update)) api.plugin.requireReload()
			}),
		)
	},
	SettingsComponent,
})
