import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { DefaultSettings } from '.'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from '.'

const { TableRowGroup, TableSwitchRow } = Design

type SettingsComponentProps = ComponentProps<
	PluginSettingsComponent<{ jsonStorage: Settings }>
>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: SettingsComponentProps) {
	const {
		showInProfile,
		showInDMs,
		showInDMHeader,
		showInMemberList,
		showInChat,
	} = storage.use() ?? DefaultSettings

	return (
		<Page>
			<TableRowGroup>
				<TableSwitchRow
					label="Show in profiles"
					value={showInProfile}
					onValueChange={showInProfile => storage.set({ showInProfile })}
				/>
				<TableSwitchRow
					label="Show in the DM list"
					value={showInDMs}
					onValueChange={showInDMs => storage.set({ showInDMs })}
				/>
				<TableSwitchRow
					label="Show in the DM header"
					value={showInDMHeader}
					onValueChange={showInDMHeader => storage.set({ showInDMHeader })}
				/>
				<TableSwitchRow
					label="Show in the member list"
					value={showInMemberList}
					onValueChange={showInMemberList => storage.set({ showInMemberList })}
				/>
				<TableSwitchRow
					label="Show in chat messages"
					value={showInChat}
					onValueChange={showInChat => storage.set({ showInChat })}
				/>
			</TableRowGroup>
		</Page>
	)
}
