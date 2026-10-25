import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { ScrollView } from 'react-native'
import { DefaultSettings } from './shared'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './shared'

const { TableRowGroup, TableSwitchRow } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

const LegacyRows: [key: keyof Settings, label: string][] = [
	['dmTopBar', 'Show icons on the DM top bar'],
	['userList', 'Show icons on the users and DMs list'],
	['profileUsername', 'Show icons on user profiles'],
]

export default function SettingsComponent({
	api: { jsonStorage: storage, plugin },
}: Props) {
	const settings = { ...DefaultSettings, ...storage.use() }

	function update(patch: Partial<Settings>) {
		const next = { ...patch }
		if (next.legacyEnabled === true) next.experimentalStatusDot = false
		if (next.experimentalStatusDot === true) next.legacyEnabled = false
		storage.set(next)
		plugin.requireReload()
	}

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 24 }}
		>
			<Page>
				<TableRowGroup
					title="Status Dot Indicators"
					description="Display platform icons directly on user status dots."
				>
					<TableSwitchRow
						label="Enable status dots indicators"
						subLabel="Replace status dots with platform icons (Needs a reload)"
						value={settings.experimentalStatusDot}
						onValueChange={experimentalStatusDot =>
							update({ experimentalStatusDot })
						}
					/>
					<TableSwitchRow
						label="Show platform icon in you bar status dot"
						value={settings.dotYouBar}
						disabled={!settings.experimentalStatusDot}
						onValueChange={dotYouBar => update({ dotYouBar })}
					/>
					<TableSwitchRow
						label="Show remaining platform icon inline with username"
						subLabel="Show additional platform indicators beside usernames"
						value={settings.statusDotInlineRemaining}
						disabled={!settings.experimentalStatusDot}
						onValueChange={statusDotInlineRemaining =>
							update({ statusDotInlineRemaining })
						}
					/>
				</TableRowGroup>
				<TableRowGroup
					title="Legacy Platform Indicators"
					description="Show platform icons next to usernames."
				>
					<TableSwitchRow
						label="Enable legacy platform indicators"
						value={settings.legacyEnabled}
						onValueChange={legacyEnabled => update({ legacyEnabled })}
					/>
					{LegacyRows.map(([key, label]) => (
						<TableSwitchRow
							key={key}
							label={label}
							value={settings[key]}
							disabled={!settings.legacyEnabled}
							onValueChange={value => update({ [key]: value })}
						/>
					))}
				</TableRowGroup>
				<TableRowGroup title="Appearance">
					<TableSwitchRow
						label="Theme compatibility mode"
						value={settings.fallbackColors}
						onValueChange={fallbackColors => update({ fallbackColors })}
					/>
				</TableRowGroup>
			</Page>
		</ScrollView>
	)
}
