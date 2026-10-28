import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { useEffect } from 'react'
import { ScrollView } from 'react-native'
import { DEFAULTS, GROUPS, ui } from './options'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from './options'

const { Stack, TableRowGroup, TableSwitchRow } = Design

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>

export default function SettingsPage({ api: { jsonStorage: storage } }: Props) {
	// Set during render, not in an effect: the first render would otherwise hide its own rows
	ui.settingsOpen = true
	useEffect(() => {
		return () => {
			ui.settingsOpen = false
		}
	}, [])

	const values = { ...DEFAULTS, ...storage.use() }

	return (
		<ScrollView
			style={{ flex: 1 }}
			contentContainerStyle={{ paddingBottom: 48 }}
		>
			<Page>
				<Stack spacing={16}>
					{GROUPS.map(group => (
						<TableRowGroup key={group.title} title={group.title}>
							{group.options.map(option => (
								<TableSwitchRow
									key={option.key}
									label={option.label}
									subLabel={option.hint}
									value={values[option.key]}
									onValueChange={(value: boolean) =>
										storage.set({ [option.key]: value })
									}
								/>
							))}
						</TableRowGroup>
					))}
				</Stack>
			</Page>
		</ScrollView>
	)
}
