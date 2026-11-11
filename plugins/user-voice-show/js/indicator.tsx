import { Stores } from '@valenced/discord/flux'
import { useSyncExternalStore } from 'react'
import { Pressable } from 'react-native'
import { Connect } from './voice'
import type { DiscordModules } from '@valenced/discord/types'
import type { ComponentType } from 'react'
import type { ChannelStore, PermissionStore, VoiceStateStore } from './voice'

type IconComponent = DiscordModules.Components.BaseIconImage

export interface Icons {
	voice: ComponentType<{ channel: unknown; size?: number }>
	mute?: IconComponent
	deaf?: IconComponent
	lock?: IconComponent
}

export interface Deps {
	icons: Icons
	open(channelId: string): void
}

function subscribe(callback: () => void) {
	const store = Stores.VoiceStateStore as VoiceStateStore

	store.addChangeListener(callback)
	return () => store.removeChangeListener(callback)
}

// "channelId:mute deaf", empty when the user is not in a voice channel
function getSnapshot(userId: string) {
	const store = Stores.VoiceStateStore as VoiceStateStore
	const state =
		store.getVoiceStateForUser(userId) ??
		store.getDiscoverableVoiceStateForUser?.(userId)

	if (!state?.channelId) return ''

	const muted = state.mute || state.selfMute ? 1 : 0
	const deafened = state.deaf || state.selfDeaf ? 1 : 0

	return `${state.channelId}:${muted}${deafened}`
}

export default function VoiceIndicator({
	userId,
	deps: { icons, open },
}: {
	userId: string
	deps: Deps
}) {
	const snapshot = useSyncExternalStore(subscribe, () => getSnapshot(userId))
	if (!snapshot) return null

	const [channelId, [muted, deafened]] = snapshot.split(':')
	const channel = (Stores.ChannelStore as ChannelStore).getChannel(channelId)

	// The channel is unknown or we are not allowed to join it
	if (
		!channel ||
		!(Stores.PermissionStore as PermissionStore).can(Connect, channel)
	) {
		const Lock = icons.lock
		return Lock ? (
			<Lock size="xs" />
		) : (
			<icons.voice channel={channel} size={16} />
		)
	}

	const StateIcon =
		deafened === '1' ? (icons.deaf ?? icons.mute) : muted === '1' && icons.mute

	return (
		<Pressable
			hitSlop={8}
			accessibilityRole="button"
			accessibilityLabel="Open voice channel"
			onPress={() => open(channelId)}
		>
			{StateIcon ? (
				<StateIcon size="xs" />
			) : (
				<icons.voice channel={channel} size={16} />
			)}
		</Pressable>
	)
}
