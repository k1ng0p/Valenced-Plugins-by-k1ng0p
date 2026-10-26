import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { useEffect, useState } from 'react'
import {
	DefaultPlatform,
	forceIdentify,
	hasIdentified,
	isSessionReady,
	onIdentify,
} from '.'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Platform, Settings } from '.'

const { Card, Stack, TableRadioGroup, TableRadioRow, Text } = Design

/** Give up on the status line if the gateway hasn't come back by then. */
const ReconnectTimeoutMs = 20_000

const PlatformRows: Record<
	Platform,
	{ label: string; subLabel: string; icon: string }
> = {
	off: {
		label: 'Off',
		subLabel: 'Default mobile status',
		icon: 'MobilePhoneIcon',
	},
	desktop: {
		label: 'Desktop (Windows)',
		subLabel: 'Shows Desktop client icon',
		icon: 'ScreenIcon',
	},
	web: {
		label: 'Web / Browser (Chrome)',
		subLabel: 'Shows Browser icon',
		icon: 'GlobeEarthIcon',
	},
	meta: {
		label: 'Meta Quest / VR',
		subLabel: 'Shows VR Icon',
		icon: 'VrHeadsetIcon',
	},
	console: {
		label: 'Console (PlayStation)',
		subLabel: 'Shows PlayStation Icon',
		icon: 'ic_playstation_device_ps5_32px',
	},
}

type SettingsComponentProps = ComponentProps<
	PluginSettingsComponent<{ jsonStorage: Settings }>
>

function useReconnectStatus() {
	const [status, setStatus] = useState('')

	useEffect(() => {
		let interval: ReturnType<typeof setInterval> | undefined

		const track = () => {
			clearInterval(interval)
			setStatus('Updating\u2026')
			const start = Date.now()
			interval = setInterval(() => {
				const elapsed = Date.now() - start
				if (isSessionReady()) {
					setStatus(`Updated in ${(elapsed / 1000).toFixed(1)}s`)
				} else if (elapsed > ReconnectTimeoutMs) {
					setStatus('Still reconnecting\u2026')
				} else return
				clearInterval(interval)
			}, 300)
		}

		const unsubscribe = onIdentify(track)
		if (hasIdentified()) track()

		return () => {
			unsubscribe()
			clearInterval(interval)
		}
	}, [])

	return status
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: SettingsComponentProps) {
	const { platform = DefaultPlatform } = storage.use() ?? {}
	const status = useReconnectStatus()

	function select(value: Platform) {
		if (value === platform) return
		storage.set({ platform: value })
		forceIdentify()
	}

	return (
		<Page>
			<Card>
				<Stack spacing={4}>
					<Text variant="text-md/bold" color="text-feedback-warning">
						Use at your own risk
					</Text>
					<Text variant="text-sm/medium" color="text-muted">
						This spoofs your Discord gateway IDENTIFY payload, which is against
						Discord's Terms of Service. Your account could be actioned for using
						this.
					</Text>
				</Stack>
			</Card>
			<TableRadioGroup
				title="Select a platform to spoof"
				value={platform}
				onChange={select}
			>
				{(Object.keys(PlatformRows) as Platform[]).map(value => {
					const { icon, ...row } = PlatformRows[value]
					const iconId = getAssetIdByName(icon, 'png')
					return (
						<TableRadioRow
							key={value}
							value={value}
							icon={iconId && <TableRowAssetIcon id={iconId} />}
							{...row}
						/>
					)
				})}
			</TableRadioGroup>
			{status && (
				<Text variant="text-sm/medium" color="text-muted">
					{status}
				</Text>
			)}
		</Page>
	)
}
