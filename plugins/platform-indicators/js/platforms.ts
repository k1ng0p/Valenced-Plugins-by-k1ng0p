import { getAssetIdByName } from '@valenced/assets'
import { Tokens } from '@valenced/discord/common/tokens'
import { Stores } from '@valenced/discord/flux'
import { Image } from 'react-native'
import { getSettings, reportError } from './shared'
import type { Settings } from './shared'

export type Context =
	| 'profile'
	| 'youBar'
	| 'memberList'
	| 'dmList'
	| 'dmHeader'
	| 'other'

export type Statuses = Record<string, string | undefined>

interface Glyph {
	w: number
	h?: number
	aspect?: number
	dx: number
	dy: number
}

interface UserStore {
	getCurrentUser?(): { id: string } | undefined
}

interface SessionsStore {
	getSessions?(): Record<
		string,
		{ status?: string; clientInfo?: { client?: string } } | undefined
	>
}

interface PresenceStore {
	getState?(): { clientStatuses?: Record<string, Statuses> } | undefined
	getStatus?(userId?: string): string | undefined
}

interface SelfPresenceStore {
	getStatus?(): string | undefined
}

const FallbackColors: Record<string, string> = {
	online: '#23a55a',
	dnd: '#f23f43',
	idle: '#f0b232',
	offline: '#80848e',
}

const StatusTokens: Record<string, string> = {
	online: 'STATUS_ONLINE',
	dnd: 'STATUS_DANGER',
	idle: 'STATUS_WARNING',
	offline: 'STATUS_OFFLINE',
}

const SurfaceTokens: Record<string, string[]> = {
	profile: [
		'BACKGROUND_FLOATING',
		'BACKGROUND_PRIMARY',
		'BACKGROUND_SECONDARY',
	],
	youBar: [
		'BACKGROUND_MOBILE_PRIMARY',
		'BACKGROUND_PRIMARY',
		'BACKGROUND_SECONDARY',
	],
	memberList: [
		'BACKGROUND_SECONDARY',
		'BACKGROUND_MOBILE_PRIMARY',
		'BACKGROUND_PRIMARY',
	],
	dmList: [
		'BACKGROUND_MOBILE_PRIMARY',
		'BACKGROUND_SECONDARY',
		'BACKGROUND_PRIMARY',
	],
	dmHeader: [
		'BACKGROUND_MOBILE_PRIMARY',
		'BACKGROUND_PRIMARY',
		'BACKGROUND_SECONDARY',
	],
	other: [
		'BACKGROUND_SECONDARY',
		'BACKGROUND_MOBILE_PRIMARY',
		'BACKGROUND_PRIMARY',
	],
}

const SurfaceFallback: Record<string, string> = {
	dmHeader: '#313338',
	dmList: '#232428',
	memberList: '#2b2d31',
	profile: '#111214',
	youBar: '#0e0e10',
}

const AssetNames: Record<string, string[]> = {
	mobile: ['MobilePhoneIcon'],
	desktop: ['ic_monitor'],
	web: ['GlobeEarthIcon'],
	embedded: ['GameControllerIcon', 'ic_playstation_device_ps5_32px'],
	vr: ['VrHeadsetIcon'],
}

const DotAssetNames: Record<string, string[]> = {
	mobile: ['StatusMobileOnline', ...AssetNames.mobile],
	vr: ['StatusVROnline', ...AssetNames.vr],
}

const DotPriority = ['desktop', 'mobile', 'web', 'embedded', 'vr']

const FallbackAspect: Record<string, number> = {
	mobile: 0.62,
	vr: 1.75,
	desktop: 1.15,
	web: 1,
	embedded: 1.3,
}

export const RingThickness = 2

export const ArtFill: Record<string, [number, number]> = {
	mobile: [0.92, 0.94],
	web: [0.84, 0.84],
}

export const ArtGlyph: Record<string, Glyph> = {
	desktop: { w: 0.78, h: 0.757, dx: -0.04, dy: 0.01 },
	embedded: { w: 0.82, h: 0.79, dx: -0.028, dy: -0.02 },
	vr: { w: 0.96, aspect: 1.58, dx: 0, dy: 0 },
}

export const ContextShift: Record<string, [number, number]> = {
	youBar: [0, 3],
	memberList: [0, 3],
	profile: [0, 3],
}

export const PlatformShift: Record<string, [number, number]> = {
	desktop: [0, 2],
}

export const PlatformListShift: Record<string, number> = {
	desktop: -2,
	embedded: -2,
}

export const ContextScale: Record<string, number> = { profile: 1.3 }

let myId: string | undefined

function resolveToken(name: string): unknown {
	try {
		const token = Tokens.default?.colors?.[name]
		return typeof token === 'string' ? token : token?.resolve?.()
	} catch (e) {
		reportError(e)
	}
}

export function statusColor(
	status: string | undefined,
	useFallback: boolean,
): string {
	const fallback = FallbackColors[status ?? 'offline'] ?? FallbackColors.offline
	if (useFallback) return fallback

	const token = resolveToken(StatusTokens[status ?? 'offline'])
	return typeof token === 'string' ? token : fallback
}

export function surfaceColor(context: Context): string {
	for (const name of SurfaceTokens[context] ?? SurfaceTokens.other) {
		const color = resolveToken(name)
		if (typeof color === 'string') return color
	}

	return SurfaceFallback[context] ?? '#242429'
}

export function normalizePlatform(platform: unknown): string {
	const name = String(platform || '').toLowerCase()
	if (name === 'ios' || name === 'android') return 'mobile'
	if (name === 'oculus' || name === 'quest' || name === 'samsung_gear_vr')
		return 'vr'
	return name
}

export function findAsset(platform: string, forDot: boolean) {
	const key = normalizePlatform(platform)
	const names = (forDot && DotAssetNames[key]) || AssetNames[key] || []
	for (const name of names) {
		const id = getAssetIdByName(name, 'png')
		if (id) return id
	}

	reportError(
		new Error(
			`No icon asset found for "${platform}" (tried: ${names.join(', ') || 'none'})`,
		),
	)
}

export function assetAspect(assetId: number, platform: string): number {
	try {
		const { width, height } = Image.resolveAssetSource(assetId)
		if (width && height) return width / height
	} catch (e) {
		reportError(e)
	}

	return FallbackAspect[platform] ?? 1
}

export function getStatuses(userId: string): Statuses | undefined {
	const { UserStore, SessionsStore, PresenceStore, SelfPresenceStore } =
		Stores as unknown as {
			UserStore?: UserStore
			SessionsStore?: SessionsStore
			PresenceStore?: PresenceStore
			SelfPresenceStore?: SelfPresenceStore
		}
	myId ??= UserStore?.getCurrentUser?.()?.id

	if (userId !== myId)
		return PresenceStore?.getState?.()?.clientStatuses?.[userId]

	const ownStatus =
		SelfPresenceStore?.getStatus?.() ?? PresenceStore?.getStatus?.(myId)
	const statuses: Statuses = {}
	for (const session of Object.values(SessionsStore?.getSessions?.() ?? {})) {
		const client = session?.clientInfo?.client
		if (!client || client === 'unknown') continue

		statuses[normalizePlatform(client)] = ownStatus ?? session?.status
	}

	return statuses
}

export function pickDotPlatform(statuses: Statuses): string | null {
	return DotPriority.find(platform => statuses[platform]) ?? null
}

export function resolveContext(size: unknown): Context {
	if (typeof size !== 'string') return 'other'
	if (size.startsWith('youBar')) return 'youBar'
	if (size === 'xxlarge') return 'profile'
	if (size === 'refreshMedium32') return 'memberList'
	return 'other'
}

export function dotAllowedForContext(context: Context): boolean {
	if (context === 'youBar') return getSettings().dotYouBar
	return true
}

export function inlineIconsAllowed(
	legacyKey: keyof Pick<Settings, 'dmTopBar' | 'userList' | 'profileUsername'>,
): boolean {
	const settings = getSettings()
	if (settings.legacyEnabled) return settings[legacyKey]
	if (settings.experimentalStatusDot) return settings.statusDotInlineRemaining
	return false
}
