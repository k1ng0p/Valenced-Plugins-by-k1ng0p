import { Checkbox } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { React, ReactNative } from '@valenced/react'
import { cachedAvatar, catalog, discordUser, githubAvatar, newRepoCount, unreadCount, useStore } from './data'
import { AVATAR_SIZE, ICON_INDENT, NOTICE, asset, h, icon, iconSlot, inform, isRemote } from './shared'
import { PluginByline, WarningNote } from './sheets'
import type { ListedPlugin, Listing, Note, Repo } from './shared'
export type CardUpdate = { from: string; to: string; state: 'ready' | 'busy' | 'pending'; onPress: () => void }

export function RepoAvatar({ repo, listing, epoch, person }: { repo: Repo; listing?: Listing; epoch: number; person?: boolean }) {
	const { Image, View } = ReactNative
	const [discordUrl, setDiscordUrl] = React.useState<string | null>(() => (repo.discord ? cachedAvatar(repo.discord) : null))
	const [failed, setFailed] = React.useState(0)

	React.useEffect(() => {
		if (!repo.discord) return
		let cancelled = false
		discordUser(repo.discord).then(user => {
			if (!cancelled) setDiscordUrl(user.avatar)
		})
		return () => {
			cancelled = true
		}
	}, [repo.discord, epoch])

	React.useEffect(() => setFailed(0), [discordUrl, epoch])

	const candidates = [discordUrl, person ? undefined : listing?.icon, githubAvatar(repo.source, epoch), githubAvatar(repo.url, epoch)]
		.filter(isRemote)
		.filter((url, index, all) => all.indexOf(url) === index)

	const frame = (child: any) => h(View, { style: { width: AVATAR_SIZE, height: AVATAR_SIZE, alignItems: 'center', justifyContent: 'center' } }, child)

	if (failed >= candidates.length) return frame(icon(isRemote(listing?.icon) ? undefined : listing?.icon))
	return frame(
		h(Image, {
			key: candidates[failed],
			source: { uri: candidates[failed] },
			style: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: '#4E5058' },
			onError: () => setFailed((count: number) => count + 1),
		}),
	)
}

type PluginCardProps = {
	plugin: ListedPlugin
	version?: string
	origin?: string
	actions: any[]
	update?: CardUpdate
	warning?: string
	selectable?: boolean
	selected?: boolean
	onPress?: () => void
	onLongPress?: () => void
}

export function PluginCard(props: PluginCardProps) {
	const { plugin, version, origin, actions, update, warning, selectable, selected, onPress, onLongPress } = props
	const { Pressable, View } = ReactNative
	const { Button, Card, Text } = Design
	return h(
		Pressable,
		{ onPress, onLongPress, delayLongPress: 350 },
		h(
			Card,
			{ style: { paddingVertical: 12, paddingHorizontal: 12 } },
			h(
				View,
				{ style: { width: '100%' } },
				h(
					View,
					{ style: { flexDirection: 'row', alignItems: 'center', width: '100%' } },
					h(
						View,
						{ style: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 } },
						iconSlot(icon(plugin.icon, 'PuzzlePieceIcon')),
						h(Text, { variant: 'heading-lg/semibold', style: { flex: 1 } }, plugin.name),
					),
					selectable
						? h(View, { style: { marginLeft: 8 } }, h(Checkbox, { checked: !!selected, onToggle: onPress }))
						: h(
								View,
								{ style: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 } },
								...actions.filter(Boolean).map((action, index) => h(View, { key: index, style: { marginLeft: index ? 8 : 0 } }, action)),
							),
				),
				h(
					View,
					{ style: { paddingLeft: ICON_INDENT, marginTop: 6 } },
					h(PluginByline, { plugin, version }),
					origin && h(Text, { color: 'text-muted', variant: 'text-sm/medium', style: { marginTop: 2 } }, origin),
					h(Text, { variant: 'text-md/medium', style: { marginTop: 4 } }, plugin.description),
					update &&
						h(
							View,
							{ style: { flexDirection: 'row', alignItems: 'center', marginTop: 8 } },
							h(
								Text,
								{ variant: 'text-sm/semibold', color: update.state === 'pending' ? 'text-muted' : 'text-link', style: { flex: 1 } },
								update.state === 'pending' ? 'Updated, reload to apply it' : `Update available: ${update.from} to ${update.to}`,
							),
							update.state !== 'pending' && h(Button, { text: 'Update', size: 'sm', icon: asset('DownloadIcon'), loading: update.state === 'busy', onPress: update.onPress }),
						),
					warning ? h(WarningNote, { text: warning }) : null,
				),
			),
		),
	)
}

export function NoteBanner({ note }: { note: Note }) {
	const { Card, Text } = Design
	const color = note.level === 'critical' ? 'text-feedback-critical' : note.level === 'warning' ? 'text-feedback-warning' : undefined
	return h(
		Card,
		{ border: 'strong', style: { paddingVertical: 14, paddingHorizontal: 16 } },
		note.title ? h(Text, { variant: 'heading-md/semibold', color }, note.title) : null,
		h(Text, { variant: 'text-sm/medium', color: color ?? 'text-muted', style: { marginTop: note.title ? 4 : 0 } }, note.text),
	)
}

export function Notice() {
	const { View } = ReactNative
	const { Card, IconButton, Text } = Design
	return h(
		Card,
		{ border: 'strong', style: { paddingVertical: 14, paddingHorizontal: 16 } },
		h(
			View,
			{ style: { flexDirection: 'row', alignItems: 'center' } },
			h(
				View,
				{ style: { flex: 1 } },
				h(Text, { variant: 'heading-md/semibold' }, 'Unofficial Plugins and Repositories'),
				h(
					Text,
					{ variant: 'text-sm/medium', color: 'text-muted', style: { marginTop: 4 } },
					'Plugins installed from unofficial sources may run unverified code in this app without your awareness. Check the source first and use at your own risk.',
				),
			),
			h(
				View,
				{ style: { marginLeft: 12 } },
				h(IconButton, {
					size: 'sm',
					variant: 'secondary',
					icon: asset('CircleInformationIcon') ?? asset('InfoIcon'),
					onPress: () => inform('Unofficial sources', NOTICE),
				}),
			),
		),
	)
}

export function FeedSection(props: { title: string; action?: string; variant?: string; loading?: boolean; onAction: () => void; children: any }) {
	const { title, action = 'Clear', variant = 'tertiary', loading, onAction, children } = props
	const { View } = ReactNative
	const { Button, Text } = Design
	return h(
		View,
		null,
		h(
			View,
			{ style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
			h(Text, { variant: 'text-md/medium', color: 'text-muted' }, title),
			h(Button, { text: action, size: 'sm', variant, loading, onPress: onAction }),
		),
		children,
	)
}

export function RepoCount() {
	const { View } = ReactNative
	const { Text } = Design
	const data = useStore()
	const unread = unreadCount(data, catalog)
	const fresh = newRepoCount(data, catalog)

	const bubble = (count: number, color: string) =>
		h(
			View,
			{ style: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, marginRight: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: color } },
			h(Text, { variant: 'text-xs/bold', style: { color: '#FFFFFF' } }, count > 99 ? '99+' : String(count)),
		)

	return h(
		View,
		{ style: { flexDirection: 'row', alignItems: 'center' } },
		fresh > 0 && bubble(fresh, '#5865F2'),
		unread > 0 && bubble(unread, '#F23F42'),
		h(Text, { variant: 'text-md/medium', color: 'text-muted' }, String(catalog.length)),
	)
}

type BadgeShape = 'circle' | 'triangle' | 'diamond' | 'star'
type BadgeTone = { fill: string; border: string; text: string; shape?: BadgeShape; shapeColor?: string }

const RARITY_COMMON: BadgeTone = { fill: '#242426', border: '#64656A', text: '#FFFFFF', shape: 'circle' }
const RARITY_RARE: BadgeTone = { fill: '#15183B', border: '#4A53C0', text: '#FFFFFF', shape: 'triangle' }
const RARITY_EPIC: BadgeTone = { fill: '#25153A', border: '#E255C0', text: '#FFFFFF', shape: 'diamond' }
const RARITY_MYTHIC: BadgeTone = { fill: '#3D1A04', border: '#C78F66', text: '#F8C29C', shape: 'star' }
const SECONDARY: BadgeTone = { fill: '#1E1E20', border: '#2F2F31', text: '#FFFFFF' }
const EXPRESSIVE: BadgeTone = { fill: '#FFFFFF', border: '#FFFFFF', text: '#3A3B3D' }
const WARNING: BadgeTone = { fill: '#DA373C', border: '#DA373C', text: '#FFFFFF' }

const BADGE_TONES: Record<string, BadgeTone> = {
	ports: RARITY_COMMON,
	themes: RARITY_COMMON,
	icons: RARITY_COMMON,
	utility: RARITY_COMMON,
	popular: RARITY_RARE,
	active: RARITY_RARE,
	new: RARITY_RARE,
	trusted: RARITY_RARE,
	maintainer: RARITY_RARE,
	developer: RARITY_EPIC,
	reviewed: RARITY_EPIC,
	contributor: RARITY_EPIC,
	official: RARITY_MYTHIC,
	'built in repo': RARITY_MYTHIC,
	verified: RARITY_MYTHIC,
	beta: SECONDARY,
	unmaintained: WARNING,
	deprecated: WARNING,
	caution: WARNING,
	archived: WARNING,
	unsafe: WARNING,
}

const MAX_BADGES = 6

function BadgeShapeIcon({ shape, color }: { shape: BadgeShape; color: string }) {
	const { Image, View } = ReactNative
	const gap = { marginRight: 5 }
	if (shape === 'circle') return h(View, { style: { ...gap, width: 9, height: 9, borderRadius: 5, backgroundColor: color } })
	if (shape === 'triangle') {
		return h(View, {
			style: { ...gap, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color },
		})
	}
	if (shape === 'diamond') return h(View, { style: { ...gap, width: 8, height: 8, backgroundColor: color, transform: [{ rotate: '45deg' }] } })
	const star = asset('StarIcon')
	return star ? h(Image, { source: star, style: { ...gap, width: 11, height: 11, tintColor: color } }) : null
}

function Badge({ label }: { label: string }) {
	const { View } = ReactNative
	const { Text } = Design
	const tone = BADGE_TONES[label.toLowerCase()] ?? EXPRESSIVE
	return h(
		View,
		{
			style: {
				flexDirection: 'row',
				alignItems: 'center',
				paddingHorizontal: 9,
				paddingVertical: 2,
				borderRadius: 999,
				borderWidth: 1,
				borderColor: tone.border,
				backgroundColor: tone.fill,
				marginRight: 6,
				marginBottom: 4,
			},
		},
		tone.shape ? h(BadgeShapeIcon, { shape: tone.shape, color: tone.shapeColor ?? tone.text }) : null,
		h(Text, { variant: 'text-xs/bold', numberOfLines: 1, style: { color: tone.text } }, label.toUpperCase()),
	)
}

export function RepoBadges({ badges }: { badges: string[] }) {
	const { View } = ReactNative
	return h(View, { style: { flexDirection: 'row', flexWrap: 'wrap' } }, ...badges.slice(0, MAX_BADGES).map(label => h(Badge, { key: label, label })))
}
