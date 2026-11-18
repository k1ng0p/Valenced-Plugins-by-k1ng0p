import { Design } from '@valenced/discord/design'
import { RootNavigationRef } from '@valenced/discord/modules/main_tabs_v2'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { patchFriendsScreen } from './friendsScreen'
import { patchUserRow } from './patches'
import SettingsComponent, { defaults } from './settings'
import type * as React from 'react'
import type { Settings } from './settings'

type Notifications = {
	type(props: { hasNameplate?: boolean }): React.ReactNode
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: defaults },
	SettingsComponent,
	start({ cleanup, plugin, jsonStorage }) {
		if (plugin.startedLate) {
			plugin.requireReload()
			return
		}
		patchUserRow(cleanup, jsonStorage, error => plugin.reportError(error))
		patchFriendsScreen(cleanup, jsonStorage, error => plugin.reportError(error))
		cleanup(
			getModuleWithImportedPath<{ default: Notifications }>(
				'modules/main_tabs_v2/native/you_bar/YouBarNotificationsButton.tsx',
				module => {
					const FriendsIcon = lookupGeneratedIconComponent('FriendsIcon')
					// the typings only allow asset IDs, Discord also takes icon elements
					const IconButton = Design.IconButton as React.ComponentType<
						Omit<React.ComponentProps<typeof Design.IconButton>, 'icon'> & {
							icon: React.ReactNode
						}
					>
					if (typeof module.default?.type !== 'function' || !FriendsIcon) {
						plugin.reportError('The You bar friends shortcut is unavailable.')
						return
					}
					cleanup(
						instead(module.default, 'type', function (args, original) {
							const notification = Reflect.apply(original, this, args)
							if (notification == null) return notification
							const nameplate = args[0].hasNameplate
							return (
								<>
									<IconButton
										size="sm"
										variant={nameplate ? 'secondary-overlay' : 'tertiary'}
										icon={
											<FriendsIcon
												size="xs"
												color={nameplate ? 'white' : undefined}
												style={{ width: 18, height: 18 }}
											/>
										}
										accessibilityLabel="Friends"
										onPress={() => {
											try {
												RootNavigationRef.getRootNavigationRef().navigate(
													'friends',
												)
											} catch (error) {
												plugin.reportError(error)
											}
										}}
									/>
									{notification}
								</>
							)
						}),
					)
				},
			),
		)
	},
	stop({ plugin }) {
		plugin.requireReload()
	},
})
