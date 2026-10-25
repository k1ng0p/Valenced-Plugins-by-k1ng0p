import { useReRender } from '@valenced/utils/react'
import { useEffect } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import {
	ArtFill,
	ArtGlyph,
	assetAspect,
	ContextScale,
	ContextShift,
	dotAllowedForContext,
	findAsset,
	getStatuses,
	PlatformListShift,
	PlatformShift,
	pickDotPlatform,
	RingThickness,
	resolveContext,
	statusColor,
	surfaceColor,
} from './platforms'
import { statusSignature, subscribe } from './presence'
import { getSettings } from './shared'
import type { ReactElement } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

interface PlatformIconProps {
	platform: string
	color: string
	iconSize?: number
	width?: number
	height?: number
	forDot?: boolean
}

interface Shape {
	left: number
	top: number
	width: number
	height: number
	borderRadius: number
}

function PlatformIcon({
	platform,
	color,
	iconSize = 16,
	width = iconSize,
	height = iconSize,
	forDot = false,
}: PlatformIconProps) {
	const assetId = findAsset(platform, forDot)

	return (
		<View>
			{assetId ? (
				<Image
					source={assetId}
					style={{ width, height, tintColor: color, resizeMode: 'contain' }}
				/>
			) : (
				<View
					style={{
						width: iconSize,
						height: iconSize,
						borderRadius: 100,
						backgroundColor: color,
					}}
				/>
			)}
		</View>
	)
}

function useStatusRerender(userId: string) {
	const rerender = useReRender()

	useEffect(() => {
		let last = statusSignature(getStatuses(userId))

		return subscribe(() => {
			const next = statusSignature(getStatuses(userId))
			if (next === last) return
			last = next
			rerender()
		})
	}, [rerender, userId])
}

export function StatusIcons({
	userId,
	size = 16,
}: {
	userId: string
	size?: number
}) {
	useStatusRerender(userId)
	const settings = getSettings()
	const statuses = getStatuses(userId) ?? {}
	const dotPlatform = settings.experimentalStatusDot
		? pickDotPlatform(statuses)
		: null

	return (
		<>
			{Object.keys(statuses)
				.filter(platform => platform !== dotPlatform)
				.map(platform => (
					<PlatformIcon
						key={platform}
						platform={platform}
						color={statusColor(statuses[platform], settings.fallbackColors)}
						iconSize={size}
					/>
				))}
		</>
	)
}

export function StatusIconsRow({ userId }: { userId: string }) {
	return (
		<View style={{ flexDirection: 'row' }}>
			<StatusIcons userId={userId} />
		</View>
	)
}

function plateShapes(
	platform: string,
	artWidth: number,
	artHeight: number,
	ringWidth: number,
	ringHeight: number,
): Shape[] {
	const t = RingThickness
	const part = (
		left: number,
		top: number,
		width: number,
		height: number,
		borderRadius: number,
	): Shape => ({ left, top, width, height, borderRadius })

	switch (platform) {
		case 'mobile':
			return [part(0, 0, ringWidth, ringHeight, artWidth * 0.14 + t)]
		case 'embedded':
			return [part(0, 0, ringWidth, ringHeight, artHeight * 0.2 + t)]
		case 'desktop': {
			const bodyHeight = artHeight * 0.77
			const footWidth = artWidth * 0.48 + t * 2
			return [
				part(0, 0, ringWidth, bodyHeight + t * 2, artWidth * 0.12 + t),
				part(
					(ringWidth - footWidth) / 2,
					bodyHeight,
					footWidth,
					ringHeight - bodyHeight,
					t,
				),
			]
		}
		case 'vr': {
			const earWidth = artWidth * 0.175 + t * 2
			const earTop = artHeight * 0.28
			const earHeight = artHeight * 0.52 + t * 2
			const earRadius = artHeight * 0.12 + t
			return [
				part(
					artWidth * 0.125,
					0,
					artWidth * 0.75 + t * 2,
					ringHeight,
					artHeight * 0.24 + t,
				),
				part(0, earTop, earWidth, earHeight, earRadius),
				part(ringWidth - earWidth, earTop, earWidth, earHeight, earRadius),
			]
		}
		default:
			return [
				part(0, 0, ringWidth, ringHeight, Math.min(ringWidth, ringHeight) / 2),
			]
	}
}

interface StatusDotProps {
	userId: string
	original: ReactElement<{ size?: number; style?: StyleProp<ViewStyle> }>
	size?: string
}

export function StatusDot({ userId, original, size }: StatusDotProps) {
	useStatusRerender(userId)
	const settings = getSettings()
	const location = resolveContext(size)
	if (!dotAllowedForContext(location)) return original

	const statuses = getStatuses(userId) ?? {}
	const platform = pickDotPlatform(statuses)
	if (!platform) return original

	const assetId = findAsset(platform, true)
	if (!assetId) return original

	const dotSize =
		typeof original.props.size === 'number' ? original.props.size : 16
	const box =
		(dotSize + (dotSize <= 20 ? 4 : 3)) * (ContextScale[location] ?? 1)
	const fit = platform === 'vr' ? box * 1.1 : box
	const aspect = assetAspect(assetId, platform)
	const width = aspect >= 1 ? fit : fit * aspect
	const height = aspect >= 1 ? fit / aspect : fit

	const glyph = ArtGlyph[platform]
	const [fillWidth, fillHeight] = ArtFill[platform] ?? [1, 1]
	const artWidth = glyph ? glyph.w * fit : width * fillWidth
	const artHeight = glyph
		? glyph.h
			? glyph.h * fit
			: artWidth / (glyph.aspect ?? 1)
		: height * fillHeight
	const offsetX = (glyph?.dx ?? 0) * fit
	const offsetY = (glyph?.dy ?? 0) * fit
	const ringWidth = artWidth + RingThickness * 2
	const ringHeight = artHeight + RingThickness * 2
	const plate = plateShapes(
		platform,
		artWidth,
		artHeight,
		ringWidth,
		ringHeight,
	)

	const style = StyleSheet.flatten(original.props.style) ?? {}
	const [contextShiftX, contextShiftY] = ContextShift[location] ?? [0, 0]
	const [platformShiftX, platformShiftY] = PlatformShift[platform] ?? [0, 0]
	const listShift =
		location === 'memberList' || location === 'dmList'
			? (PlatformListShift[platform] ?? 0)
			: 0
	const shiftX = contextShiftX + platformShiftX
	const shiftY = contextShiftY + platformShiftY + listShift
	const right =
		(typeof style.right === 'number' ? style.right : -3) +
		box / 2 -
		ringWidth / 2 +
		shiftX
	const bottom =
		(typeof style.bottom === 'number' ? style.bottom : -3) +
		box / 2 -
		ringHeight / 2 +
		shiftY

	const backgroundColor =
		(style.backgroundColor as string | undefined) ?? surfaceColor(location)

	return (
		<View
			style={{
				position: 'absolute',
				right,
				bottom,
				width: ringWidth,
				height: ringHeight,
			}}
		>
			{plate.map(shape => (
				<View
					key={`${shape.left}:${shape.top}`}
					style={{
						position: 'absolute',
						backgroundColor,
						...shape,
						left: shape.left + offsetX,
						top: shape.top + offsetY,
					}}
				/>
			))}
			<View
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					alignItems: 'center',
					justifyContent: 'center',
					transform: [{ translateX: offsetX }, { translateY: offsetY }],
				}}
			>
				<PlatformIcon
					platform={platform}
					color={statusColor(statuses[platform], settings.fallbackColors)}
					width={width}
					height={height}
					forDot
				/>
			</View>
		</View>
	)
}
