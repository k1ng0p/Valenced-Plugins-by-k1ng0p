import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from '.'

type SettingComponentProps = ComponentProps<
	PluginSettingsComponent<{ jsonStorage: Settings }>
>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: SettingComponentProps) {
	const { TableRowGroup, TableSwitchRow } = Design
	const { bio } = storage.use()!

	return (
		<Page>
			<TableRowGroup>
				<TableSwitchRow
					icon={<TableRowAssetIcon name="ReactionIcon" />}
					label="React and reply to bios"
					subLabel="Tap a friend's bio on their profile to react or reply."
					value={bio ?? true}
					onValueChange={bio => storage.set({ bio })}
				/>
			</TableRowGroup>
		</Page>
	)
}
