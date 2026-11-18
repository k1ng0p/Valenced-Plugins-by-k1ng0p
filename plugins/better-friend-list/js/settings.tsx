import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'

export interface Settings {
	hideCallButton: boolean
	hideChatButton: boolean
	hideEmptyRequests: boolean
}

export const defaults: Settings = {
	hideCallButton: true,
	hideChatButton: false,
	hideEmptyRequests: true,
}

export default function SettingsComponent({
	api: { jsonStorage },
}: ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>) {
	const { hideCallButton, hideChatButton, hideEmptyRequests } = {
		...defaults,
		...jsonStorage.use(),
	}
	return (
		<Page>
			<Design.TableRowGroup title="Friends">
				<Design.TableSwitchRow
					label="Hide call button"
					subLabel="Removes the call button from friend rows"
					value={hideCallButton}
					onValueChange={hideCallButton => jsonStorage.set({ hideCallButton })}
				/>
				<Design.TableSwitchRow
					label="Hide chat button"
					subLabel="Removes the message button from friend rows"
					value={hideChatButton}
					onValueChange={hideChatButton => jsonStorage.set({ hideChatButton })}
				/>
				<Design.TableSwitchRow
					label="Hide empty friend requests"
					subLabel="Removes the Friend Requests row when you have none"
					value={hideEmptyRequests}
					onValueChange={hideEmptyRequests =>
						jsonStorage.set({ hideEmptyRequests })
					}
				/>
			</Design.TableRowGroup>
		</Page>
	)
}
