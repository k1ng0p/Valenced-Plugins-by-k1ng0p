import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { clearLastSeen, DefaultSettings, Labels } from './presence'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Label, Settings, TimeFormat } from './presence'

const { TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	return (
		<Page>
			<ScrollView
				contentContainerStyle={{ paddingTop: 16, paddingBottom: 40, gap: 16 }}
			>
				<TableRadioGroup
					title="Label"
					defaultValue={settings.label}
					onChange={(label: Label) => storage.set({ label })}
				>
					{Labels.map(label => (
						<TableRadioRow key={label} label={label} value={label} />
					))}
				</TableRadioGroup>
				<TableRadioGroup
					title="Time format"
					defaultValue={settings.timeFormat}
					onChange={(timeFormat: TimeFormat) => storage.set({ timeFormat })}
				>
					<TableRadioRow label="Relative (5m ago)" value="relative" />
					<TableRadioRow label="Exact (2:34 PM)" value="exact" />
				</TableRadioGroup>
				<TableRowGroup title="Where to show it">
					<TableSwitchRow
						label="DM list"
						subLabel="Can look inconsistent or flicker if your message previews are set to All."
						value={settings.dmList}
						onValueChange={dmList => storage.set({ dmList })}
					/>
					<TableSwitchRow
						label="Member list and DM header"
						value={settings.memberList}
						onValueChange={memberList => storage.set({ memberList })}
					/>
				</TableRowGroup>
				<TableRowGroup title="Who to track">
					<TableSwitchRow
						label="Friends only"
						subLabel="Only track people on your friends list."
						value={settings.friendsOnly}
						onValueChange={friendsOnly => storage.set({ friendsOnly })}
					/>
				</TableRowGroup>
				<TableRowGroup title="Persistence">
					<TableSwitchRow
						label="Save last seen across restarts"
						subLabel="A saved time only updates when that person goes offline again, so it can look outdated until then."
						value={settings.persist}
						onValueChange={persist => {
							storage.set({ persist })
							if (!persist) clearLastSeen()
						}}
					/>
				</TableRowGroup>
			</ScrollView>
		</Page>
	)
}
