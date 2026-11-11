import { Stores } from '@valenced/discord/flux'
import type { DiscordModules } from '@valenced/discord/types'

export type VoiceGlyph = 'speaker' | 'mute' | 'deaf' | 'lock'

export const GlyphAssets: Record<VoiceGlyph, string[]> = {
	speaker: ['SpeakerIcon', 'VoiceNormalIcon'],
	mute: ['MicrophoneDenyIcon'],
	deaf: ['HeadphonesDenyIcon'],
	lock: ['VoiceLockIcon'],
}

export interface VoiceState {
	channelId?: string | null
	mute?: boolean
	deaf?: boolean
	selfMute?: boolean
	selfDeaf?: boolean
}

export type VoiceStateStore = DiscordModules.Flux.Store<{
	getVoiceStateForUser(userId: string): VoiceState | undefined
	getDiscoverableVoiceStateForUser?(userId: string): VoiceState | undefined
}>

export type ChannelStore = DiscordModules.Flux.Store<{
	getChannel(channelId: string): unknown
}>

export type PermissionStore = DiscordModules.Flux.Store<{
	can(permission: bigint, channel: unknown): boolean
}>

export const Connect = BigInt(1) << BigInt(20)

function getVoiceState(userId: string) {
	const store = Stores.VoiceStateStore as VoiceStateStore
	return (
		store.getVoiceStateForUser(userId) ??
		store.getDiscoverableVoiceStateForUser?.(userId)
	)
}

function canConnect(channelId: string) {
	const channel = (Stores.ChannelStore as ChannelStore).getChannel(channelId)
	return (
		!!channel &&
		(Stores.PermissionStore as PermissionStore).can(Connect, channel)
	)
}

export function getVoiceGlyph(userId: string): VoiceGlyph | undefined {
	const state = getVoiceState(userId)
	if (!state?.channelId) return

	if (!canConnect(state.channelId)) return 'lock'
	if (state.deaf || state.selfDeaf) return 'deaf'
	if (state.mute || state.selfMute) return 'mute'
	return 'speaker'
}

export function getJoinableChannelId(userId: string) {
	const channelId = getVoiceState(userId)?.channelId
	return channelId && canConnect(channelId) ? channelId : undefined
}
