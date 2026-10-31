import { FormSwitch, SheetHeader, TableRowAssetIcon } from '@valenced/components'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Tokens } from '@valenced/discord/common/tokens'
import { Design } from '@valenced/discord/design'
import { BottomSheet as Gorhom } from '@valenced/externals/gorhom'
import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'
import { parsePluginContributor } from '@valenced/plugins/utils'
import { React, ReactNative } from '@valenced/react'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { catalog, dependentsOf, dismiss, dismissAll, isLegacy, listings, missingDependencies, openUserProfile, setAlertMode, setKindMuted, useStore } from './data'
import { available, blocked, checkInstall, install, openPluginSettings, pendingReload, putRepos, readState, setHeld, toggle, uninstall, updatePlugins } from './valenced'
import type { BulkItem } from './valenced'
import type { ValencedState } from './valenced'
import { ALERT_MODES, ICON_INDENT, OWNER_ID, tap, SOURCE_URL, ago, asset, isBuiltIn, compatibilityWarning, copyToClipboard, fail, formatBytes, h, icon, iconSlot, native, reportError, slash } from './shared'
import type { AlertMode, ListedPlugin, PluginKind, PluginRef, Repo, RepoListing } from './shared'

const PLUGIN_SHEET = 'plugin-browser-plugin-sheet'
const PICKER_SHEET = 'plugin-browser-ref-picker'
const REPO_SHEET = 'plugin-browser-repo-picker'
const CONTRIBUTORS_SHEET = 'plugin-browser-contributors'
const BULK_SHEET = 'plugin-browser-bulk-install'
const REPO_INFO_SHEET = 'plugin-browser-repo-info'
const KINDS_SHEET = 'plugin-browser-repo-kinds'
const FEED_SHEET = 'plugin-browser-feed'
const ABOUT_SHEET = 'plugin-browser-about'

const MAX_GROWING_TABS = 3
const MAX_SHOWN_ENTRIES = 5
const NAME_BREAK_LENGTH = 24
const NAME_MAX_LENGTH = 36

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const formatRepository = (url: string, name?: string | null) => (name ? `${name} (${url})` : url)
const formatLink = (link: string) => link.replace(/^(?:https?:\/\/|mailto:)/i, '').replace(/\/$/, '')

const pickChannel = (listing: RepoListing, preferred?: string) => {
	const names = Object.keys(listing.channels)
	if (preferred && preferred in listing.channels) return preferred
	if ('latest' in listing.channels) return 'latest'
	return names.sort((a, b) => a.localeCompare(b))[0] ?? 'latest'
}

const versionOfChannel = (listing: RepoListing, channel: string) => listing.channels[channel] ?? listing.order[0]

// the closest ref in another repository, a missing version falls back to a channel
function retarget(ref: PluginRef, listing: RepoListing): PluginRef {
	if (ref.type === 'channel') return { type: 'channel', channel: pickChannel(listing, ref.channel) }
	if (ref.version in listing.versions) return ref
	const version = versionOfChannel(listing, pickChannel(listing))
	return version ? { type: 'version', version } : { type: 'channel', channel: pickChannel(listing) }
}

async function findListing(repo: string, id: string, refresh = false): Promise<RepoListing | undefined> {
	if (!refresh) {
		try {
			const cached: RepoListing[] = await native('valenced.plugins.repos.listPlugins', [repo])
			return cached.find(listing => listing.id === id)
		} catch {
			// not cached yet, so fetch the index below
		}
	}
	await native('valenced.plugins.repos.refresh', [repo])
	const fresh: RepoListing[] = await native('valenced.plugins.repos.listPlugins', [repo])
	return fresh.find(listing => listing.id === id)
}

function ContributorEntries({ contributor }: { contributor: { name: string; ids: string[]; links: { url: string; label?: string }[] } }) {
	const { View, Linking } = ReactNative
	const { TableRow, TableRowGroup, Text } = Design
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()

	const ids = [...new Set(contributor.ids)].slice(0, MAX_SHOWN_ENTRIES)
	const links = [...new Map(contributor.links.filter(link => /^(https:|mailto:)/i.test(link.url)).map(link => [link.url, link])).values()].slice(0, MAX_SHOWN_ENTRIES)

	return h(
		View,
		{ style: { flex: 1, marginHorizontal: 16, paddingBottom: 16 + bottom } },
		ids.length || links.length
			? h(TableRowGroup, { hasIcons: true, title: `Contacts for ${contributor.name}` }, [
					...ids.map(id => h(TableRow, { key: id, icon: h(TableRowAssetIcon, { name: 'ClydeIcon' }), label: 'Discord', subLabel: id, arrow: true, onPress: () => openUserProfile(id) })),
					...links.map(({ url, label }) =>
						h(TableRow, {
							key: url,
							icon: h(TableRowAssetIcon, { name: 'LinkIcon' }),
							label: label ?? formatLink(url),
							subLabel: label ? formatLink(url) : undefined,
							arrow: true,
							onPress: () => Linking.openURL(url),
						}),
					),
				])
			: h(Text, { variant: 'text-md/medium', color: 'text-muted' }, 'No contact information.'),
	)
}

function ContactsSheet({ title, people }: { title: string; people: string[] }) {
	const { View } = ReactNative
	const { BottomSheet, SegmentedControlPages, Tabs, Text, useSegmentedControlState } = Design
	const [pageWidth, setPageWidth] = React.useState(0)

	const items = React.useMemo(
		() =>
			people.map((raw, index) => {
				const contributor = parsePluginContributor(raw) ?? { name: raw, ids: [], links: [] }
				return { id: String(index), label: contributor.name, page: h(ContributorEntries, { contributor }) }
			}),
		[people],
	)
	const state = useSegmentedControlState({ items, pageWidth })

	const header = h(
		View,
		{ style: { flexDirection: 'row', marginHorizontal: 16, justifyContent: 'center' } },
		h(Text, { variant: 'redesign/heading-18/bold', color: 'mobile-text-heading-primary', accessibilityRole: 'header' }, title),
	)

	if (items.length === 1) return h(BottomSheet, { scrollable: true, header }, h(View, { style: { flex: 1, gap: 20, paddingTop: 8 } }, items[0].page))

	return h(
		BottomSheet,
		{ scrollable: true, header },
		h(
			View,
			{ style: { flex: 1, gap: 20, paddingTop: 8 }, onLayout: (e: any) => setPageWidth(e.nativeEvent.layout.width) },
			h(View, null, h(Tabs, { state, grow: items.length <= MAX_GROWING_TABS })),
			h(SegmentedControlPages, { state }),
		),
	)
}

const openContacts = (title: string, people: string[]) =>
	ActionSheetActionCreators.openLazy(Promise.resolve({ default: ContactsSheet }), CONTRIBUTORS_SHEET, { title, people }, 'stack')

// only the author, contributors are shown on their own line
function PluginAuthor({ pluginName, author }: { pluginName: string; author: string }) {
	const { Pressable } = ReactNative
	const { Text } = Design
	const parsed = parsePluginContributor(author)

	if (!parsed || !(parsed.ids.length || parsed.links.length)) {
		return h(Text, { color: 'text-subtle', style: { flexShrink: 1 }, variant: 'heading-md/medium' }, parsed?.name ?? author)
	}

	return h(
		Pressable,
		{
			accessibilityRole: 'button',
			accessibilityHint: 'Shows contacts of the author',
			android_ripple: { borderless: false },
			style: { flexShrink: 1 },
			onPress: () => openContacts(`Author of ${pluginName}`, [author]),
		},
		h(Text, { variant: 'heading-md/medium', style: { color: Tokens.default.colors.TEXT_BRAND, fontWeight: 'bold' } }, parsed.name),
	)
}

// only what the plugin lists as contributors in its manifest
function PluginContributors({ pluginName, contributors }: { pluginName: string; contributors: string[] }) {
	const { Pressable } = ReactNative
	const { Text } = Design

	const people = contributors.map(raw => parsePluginContributor(raw)?.name ?? raw)
	let names = ''
	let shown = 0
	while (shown < people.length) {
		const next = shown === 0 ? people[shown] : `${names}, ${people[shown]}`
		if (next.length <= NAME_BREAK_LENGTH) {
			names = next
			shown++
		} else {
			if (shown === people.length - 1 && next.length <= NAME_MAX_LENGTH) {
				names = next
				shown++
			}
			break
		}
	}
	const left = people.length - shown
	const text = names ? `with ${names}${left ? `, ${pluralize(left, 'contributor')}` : ''}` : `with ${pluralize(people.length, 'contributor')}`

	return h(
		Pressable,
		{
			accessibilityRole: 'button',
			accessibilityHint: 'Shows contacts of the contributors',
			android_ripple: { borderless: false },
			style: { flexShrink: 1 },
			onPress: () => openContacts(`Contributors of ${pluginName}`, contributors),
		},
		h(Text, { variant: 'text-sm/medium', style: { color: Tokens.default.colors.TEXT_BRAND } }, text),
	)
}

export function PluginByline({ plugin, version }: { plugin: ListedPlugin; version?: string }) {
	const { Stack, Text } = Design
	return h(
		Stack,
		{ spacing: 2 },
		h(
			Stack,
			{ direction: 'horizontal', spacing: 0, align: 'baseline', style: { flexWrap: 'wrap' } },
			h(Text, { color: 'text-subtle', variant: 'heading-md/medium' }, 'by '),
			h(PluginAuthor, { pluginName: plugin.name, author: plugin.author ?? '' }),
			version ? h(Text, { color: 'text-subtle', variant: 'heading-md/medium' }, ` \u2022 ${version}`) : null,
		),
		plugin.contributors?.length ? h(PluginContributors, { pluginName: plugin.name, contributors: plugin.contributors }) : null,
	)
}

export function WarningNote({ text }: { text: string }) {
	const { Image, View } = ReactNative
	const { Text } = Design
	return h(
		View,
		{ style: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6 } },
		h(Image, { source: asset('WarningIcon'), style: { width: 16, height: 16, marginTop: 1, marginRight: 4, tintColor: Tokens.default.colors.TEXT_FEEDBACK_WARNING } }),
		h(Text, { variant: 'text-sm/semibold', color: 'text-feedback-warning', style: { flex: 1 } }, text),
	)
}

function RefPage({ children, empty }: { children?: any; empty: string }) {
	const { Text } = Design
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()

	return h(
		Gorhom.BottomSheetScrollView,
		{ style: { flex: 1 }, contentContainerStyle: { marginHorizontal: 16, paddingBottom: 16 + bottom } },
		children || h(Text, { variant: 'text-md/medium', color: 'text-muted' }, empty),
	)
}

type RefPickerProps = {
	id: string
	repo: string
	pluginRef: PluginRef
	onSelect: (ref: PluginRef) => Promise<boolean> | boolean
}

function RefPickerSheet({ id, repo, pluginRef, onSelect }: RefPickerProps) {
	const { View } = ReactNative
	const { BottomSheet, Button, SegmentedControlPages, TableRadioGroup, TableRadioRow, Tabs, useSegmentedControlState } = Design
	const [selected, setSelected] = React.useState(pluginRef)
	const [listing, setListing] = React.useState<RepoListing | null | undefined>()
	const [loading, setLoading] = React.useState(false)
	const [pageWidth, setPageWidth] = React.useState(0)
	const busy = React.useRef(false)

	const load = React.useCallback(
		async (refresh: boolean) => {
			setLoading(true)
			try {
				setListing((await findListing(repo, id, refresh)) ?? null)
			} catch (e) {
				fail(e, `load ${id}`)
				if (!refresh) setListing(null)
			} finally {
				setLoading(false)
			}
		},
		[repo, id],
	)

	React.useEffect(() => {
		load(false)
	}, [load])

	const items = React.useMemo(() => {
		if (!listing) return []

		const select = (ref: PluginRef) => {
			if (busy.current) return
			busy.current = true
			Promise.resolve(onSelect(ref))
				.then(picked => {
					if (picked) setSelected(ref)
				})
				.finally(() => {
					busy.current = false
				})
		}

		const channels = Object.keys(listing.channels)
		const versions = listing.order

		return [
			{
				id: 'channels',
				label: 'Channels',
				count: channels.length,
				page: h(
					RefPage,
					{ empty: 'No channels in this repository.' },
					channels.length > 0 &&
						h(
							TableRadioGroup,
							{
								title: 'Follow a channel',
								description: 'Updates install automatically as the channel moves.',
								value: selected.type === 'channel' ? selected.channel : null,
								onChange: (channel: string | null) => {
									if (channel && !(selected.type === 'channel' && selected.channel === channel)) select({ type: 'channel', channel })
								},
							},
							...Object.entries(listing.channels).map(([channel, version]) => h(TableRadioRow, { key: channel, label: channel, subLabel: `v${version}`, value: channel })),
						),
				),
			},
			{
				id: 'versions',
				label: 'Versions',
				count: versions.length,
				page: h(
					RefPage,
					{ empty: 'No versions in this repository.' },
					versions.length > 0 &&
						h(
							TableRadioGroup,
							{
								title: 'Stay on a version',
								description: 'Pauses updates for this plugin.',
								value: selected.type === 'version' ? selected.version : null,
								onChange: (version: string | null) => {
									if (version && !(selected.type === 'version' && selected.version === version)) select({ type: 'version', version })
								},
							},
							...versions.map(version => {
								const channels = Object.entries(listing.channels)
									.filter(([, target]) => target === version)
									.map(([channel]) => channel)
								return h(TableRadioRow, { key: version, label: `v${version}`, subLabel: [...channels, formatBytes(listing.versions[version].size)].join(' \u2022 '), value: version })
							}),
						),
				),
			},
		]
	}, [listing, selected, onSelect])

	const state = useSegmentedControlState({ items, pageWidth, defaultIndex: selected.type === 'version' ? 1 : 0 })

	return h(
		BottomSheet,
		{
			scrollable: true,
			header: h(SheetHeader, {
				title: 'Select a channel or version',
				action: h(Button, { size: 'sm', variant: 'secondary', icon: asset('RetryIcon'), text: 'Refresh', loading, disabled: loading, onPress: () => load(true) }),
			}),
		},
		items.length
			? h(
					View,
					{ style: { flex: 1, gap: 20, paddingTop: 8 }, onLayout: (e: any) => setPageWidth(e.nativeEvent.layout.width) },
					h(View, null, h(Tabs, { state })),
					h(SegmentedControlPages, { state }),
				)
			: listing === null && h(RefPage, { empty: 'This repository no longer serves this plugin.' }),
	)
}

type RepoPickerProps = {
	id: string
	name: string
	repo: string | null
	onSelect: (url: string) => Promise<boolean> | boolean
}

function RepoPickerSheet({ id, name, repo, onSelect }: RepoPickerProps) {
	const { BottomSheet, TableRadioGroup, TableRadioRow } = Design
	const [selected, setSelected] = React.useState(repo)
	const offers = catalog.filter(item => listings.get(item.url)?.plugins.some(plugin => plugin.id === id))

	return h(
		BottomSheet,
		{ scrollable: true, header: h(SheetHeader, { title: `Repositories offering ${name}` }) },
		h(
			RefPage,
			{ empty: 'No other repository offers this plugin.' },
			offers.length > 0 &&
				h(
					TableRadioGroup,
					{
						title: 'Repository',
						value: selected,
						onChange: (url: string | null) => {
							if (!url || url === selected) return
							Promise.resolve(onSelect(url)).then(picked => {
								if (picked) setSelected(url)
							})
						},
					},
					...offers.map(item => h(TableRadioRow, { key: item.url, label: listings.get(item.url)?.name ?? item.url, subLabel: listings.get(item.url)?.name ? item.url : undefined, value: item.url })),
				),
		),
	)
}

type RepoInfoProps = { repo: Repo; name: string; updated?: string; note?: string; kinds: { id: PluginKind; label: string }[]; mode: AlertMode; muted: PluginKind[] }

function RepoInfoSheet({ repo, name, updated, note, kinds, mode, muted }: RepoInfoProps) {
	const { Linking } = ReactNative
	const { BottomSheet, BottomSheetTitleHeader, Stack, TableRadioGroup, TableRadioRow, TableRow, TableRowGroup, TableSwitchRow } = Design
	const [selected, setSelected] = React.useState(mode)
	const [off, setOff] = React.useState(muted)
	const link = repo.source ?? repo.url

	return h(
		BottomSheet,
		{ scrollable: true, header: h(BottomSheetTitleHeader, { title: name }) },
		h(
			RefPage,
			{ empty: '' },
			h(
				Stack,
				{ spacing: 16 },
			h(
				TableRowGroup,
				{ title: repo.source ? 'Source' : 'Website', description: [updated, note].filter(Boolean).join('\n') || undefined },
				h(TableRow, { label: repo.source ? 'Source' : 'Website', subLabel: link, icon: icon(repo.source ? 'PaperIcon' : 'GlobeEarthIcon'), arrow: true, onPress: () => Linking.openURL(link) }),
			),
			h(
				TableRadioGroup,
				{
					title: 'Notifications',
					description: 'Choose what this repository adds to the red count on the settings row.',
					value: selected,
					onChange: (value: AlertMode) => {
						setSelected(value)
						setAlertMode(repo.url, value)
					},
				},
				...(Object.entries(ALERT_MODES) as [AlertMode, (typeof ALERT_MODES)[AlertMode]][]).map(([value, { button }]) => h(TableRadioRow, { key: value, label: button, value })),
			),
			kinds.length > 1
				? h(
						TableRowGroup,
						{ title: 'Notify about' },
						kinds.map(kind =>
							h(TableSwitchRow, {
								key: kind.id,
								label: kind.label,
								value: !off.includes(kind.id),
								onValueChange: (value: boolean) => {
									setOff(value ? off.filter(item => item !== kind.id) : [...off, kind.id])
									setKindMuted(repo.url, kind.id, !value)
								},
							}),
						),
					)
				: null,
			),
		),
	)
}

type KindsProps = { kinds: { id: PluginKind; title: string; subLabel: string }[]; onSelect: (kind: PluginKind) => void }

function KindsSheet({ kinds, onSelect }: KindsProps) {
	const { BottomSheet, BottomSheetTitleHeader, TableRow, TableRowGroup } = Design

	return h(
		BottomSheet,
		{ scrollable: true, header: h(BottomSheetTitleHeader, { title: 'Also in this repository' }) },
		h(
			RefPage,
			{ empty: 'Nothing else is listed here.' },
			h(
				TableRowGroup,
				{},
				kinds.map(kind =>
					h(TableRow, {
						key: kind.id,
						label: kind.title,
						subLabel: kind.subLabel,
						arrow: true,
						onPress: () => {
							ActionSheetActionCreators.hideActionSheet(KINDS_SHEET)
							onSelect(kind.id)
						},
					}),
				),
			),
		),
	)
}

export type FeedItem = { repo: Repo; plugin: ListedPlugin; at: number; from?: string; to?: string }
export type UpdateItem = { repo: Repo; plugin: ListedPlugin; from: string; to: string }
type FeedProps = {
	newsTitle: string
	load: (type: 'news' | 'updates') => FeedItem[]
	updates: () => UpdateItem[]
	repoName: (repo: Repo) => string
	onOpen: (repo: Repo) => void
	onUpdate: (ids: string[]) => Promise<void>
	onOpenPlugin: (repo: Repo, plugin: ListedPlugin) => void
}

function FeedSheet({ newsTitle, load, updates, repoName, onOpen, onUpdate, onOpenPlugin }: FeedProps) {
	const { View } = ReactNative
	const { BottomSheet, BottomSheetTitleHeader, Button, Stack, TableRow, TableRowGroup, Text } = Design
	const [busy, setBusy] = React.useState(false)
	// clearing a section changes the store, which redraws the sheet
	useStore()

	const block = (key: string, title: string, action: any, rows: any[]) =>
		h(
			View,
			{ key },
			h(
				View,
				{ style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
				h(Text, { variant: 'text-md/medium', color: 'text-muted' }, title),
				action,
			),
			h(TableRowGroup, null, rows),
		)

	const feed = (type: 'news' | 'updates', title: string) => {
		const items = load(type)
		if (!items.length) return null
		return block(
			type,
			title,
			h(Button, { text: 'Clear', size: 'sm', variant: 'tertiary', onPress: () => dismissAll(type) }),
			items.map(item =>
				h(TableRow, {
					key: `${type}:${item.repo.url}#${item.plugin.id}`,
					icon: icon(item.plugin.icon, 'PuzzlePieceIcon'),
					label: item.plugin.name,
					subLabel: `${type === 'news' ? 'New in' : 'Updated in'} ${repoName(item.repo)}\n${type === 'updates' ? `${item.from} to ${item.to}\n` : ''}${ago(item.at)}`,
					subLabelLineClamp: 3,
					arrow: true,
					onPress: () => {
						dismiss(type, item.repo.url, item.plugin.id)
						ActionSheetActionCreators.hideActionSheet(FEED_SHEET)
						onOpen(item.repo)
					},
				}),
			),
		)
	}

	const waiting = updates()
	const available = waiting.length
		? block(
				'available',
				'Updates available',
				h(Button, {
					text: 'Update all',
					size: 'sm',
					variant: 'primary',
					loading: busy,
					disabled: busy,
					onPress: async () => {
						setBusy(true)
						try {
							await onUpdate(waiting.map(item => item.plugin.id))
						} finally {
							setBusy(false)
						}
					},
				}),
				waiting.map(item =>
					h(TableRow, {
						key: `update:${item.plugin.id}`,
						icon: icon(item.plugin.icon, 'PuzzlePieceIcon'),
						label: item.plugin.name,
						subLabel: `${item.from} to ${item.to}\nfrom ${repoName(item.repo)}`,
						subLabelLineClamp: 2,
						arrow: true,
						onPress: () => {
							ActionSheetActionCreators.hideActionSheet(FEED_SHEET)
							onOpenPlugin(item.repo, item.plugin)
						},
					}),
				),
			)
		: null

	return h(
		BottomSheet,
		{ scrollable: true, header: h(BottomSheetTitleHeader, { title: "What's new" }) },
		h(RefPage, { empty: 'Nothing new right now.' }, h(Stack, { spacing: 16 }, available, feed('news', newsTitle), feed('updates', 'Recently updated'))),
	)
}

type AboutProps = { name: string; avatar: ReturnType<typeof h>; overview: () => { stats: { label: string; value: number }[]; loading: number } }

function AboutSheet({ name, avatar, overview }: AboutProps) {
	const { Linking, View } = ReactNative
	const { BottomSheet, BottomSheetTitleHeader, Button, Card, Stack, TableRow, TableRowGroup, Text } = Design
	// the numbers move while repositories load, so the sheet asks again every second
	const [, redraw] = React.useReducer((count: number) => count + 1, 0)
	React.useEffect(() => {
		const timer = setInterval(redraw, 1000)
		return () => clearInterval(timer)
	}, [])
	const { stats, loading } = overview()

	return h(
		BottomSheet,
		{ scrollable: true, header: h(BottomSheetTitleHeader, { title: 'Plugin Browser' }) },
		h(
			RefPage,
			{ empty: '' },
			h(
				Stack,
				{ spacing: 16 },
				h(
					TableRowGroup,
					null,
					h(TableRow, { label: name, subLabel: 'Author', icon: avatar, arrow: true, onPress: () => openUserProfile(OWNER_ID) }),
					h(TableRow, { label: 'Source', subLabel: SOURCE_URL, subLabelLineClamp: 3, icon: icon('PaperIcon'), arrow: true, onPress: () => Linking.openURL(SOURCE_URL) }),
				),
				h(
					Card,
					{ border: 'strong', style: { padding: 16 } },
					h(Text, { variant: 'heading-md/semibold', style: { marginBottom: 12 } }, 'Overview'),
					// three equal columns, each row the same height, every value centred over its label
					h(
						View,
						{ style: { gap: 16 } },
						[0, 3].map(start =>
							h(
								View,
								{ key: start, style: { flexDirection: 'row' } },
								[0, 1, 2].map(offset => {
									const item = stats[start + offset]
									return h(
										View,
										{ key: offset, style: { flex: 1, alignItems: 'center' } },
										item ? h(Text, { variant: 'heading-lg/semibold' }, String(item.value)) : null,
										item ? h(Text, { variant: 'text-xs/medium', color: 'text-muted' }, item.label) : null,
									)
								}),
							),
						),
					),
					loading ? h(Text, { variant: 'text-xs/medium', color: 'text-muted', style: { marginTop: 12, textAlign: 'center' } }, `Loading ${loading} more...`) : null,
				),
				h(
					Card,
					{ border: 'strong', style: { padding: 16 } },
					h(Text, { variant: 'heading-md/semibold' }, 'Want your repo in the list?'),
					h(Text, { variant: 'text-sm/medium', color: 'text-muted', style: { marginTop: 2 } }, "Send me the link on Discord and I'll add it."),
					h(
						View,
						{ style: { flexDirection: 'row', gap: 8, marginTop: 12 } },
						h(View, { style: { flex: 1 } }, h(Button, { text: 'Message me', variant: 'primary', onPress: () => openUserProfile(OWNER_ID) })),
						h(
							View,
							{ style: { flex: 1 } },
							h(Button, {
								text: 'Copy ID',
								variant: 'secondary',
								onPress: () => {
									copyToClipboard(OWNER_ID)
									tap()
								},
							}),
						),
					),
				),
			),
		),
	)
}

export const openAboutSheet = (props: AboutProps) => ActionSheetActionCreators.openLazy(Promise.resolve({ default: AboutSheet }), ABOUT_SHEET, props)

export const openFeedSheet = (props: FeedProps) => ActionSheetActionCreators.openLazy(Promise.resolve({ default: FeedSheet }), FEED_SHEET, props)

export const openKindsSheet = (props: KindsProps) => ActionSheetActionCreators.openLazy(Promise.resolve({ default: KindsSheet }), KINDS_SHEET, props)

export const openRepoInfoSheet = (props: RepoInfoProps) => ActionSheetActionCreators.openLazy(Promise.resolve({ default: RepoInfoSheet }), REPO_INFO_SHEET, props)

const openRefPicker = (props: RefPickerProps) => ActionSheetActionCreators.openLazy(Promise.resolve({ default: RefPickerSheet }), PICKER_SHEET, props, 'stack')
const openRepoPicker = (props: RepoPickerProps) => ActionSheetActionCreators.openLazy(Promise.resolve({ default: RepoPickerSheet }), REPO_SHEET, props, 'stack')

type SheetProps = { repo: Repo; plugin: ListedPlugin; onChange: () => void }

function PluginSheet({ repo: initialRepo, plugin, onChange }: SheetProps) {
	const { View } = ReactNative
	const { ActionSheet, Button, IconButton, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } = Design
	const { id, name } = plugin

	const [state, setState] = React.useState<ValencedState | null>(null)
	const [repo, setRepo] = React.useState(initialRepo)
	const [ref, setRef] = React.useState<PluginRef>({ type: 'channel', channel: 'latest' })
	const [listing, setListing] = React.useState<RepoListing | null>(null)
	const [enabledNow, setEnabledNow] = React.useState<boolean | null>(null)
	const [busy, setBusy] = React.useState(false)
	const [blockReason, setBlockReason] = React.useState<string | null>(null)

	const refresh = React.useCallback(
		() =>
			readState()
				.then(next => {
					setState(next)
					setEnabledNow(null)
				})
				.catch(reportError),
		[],
	)

	React.useEffect(() => {
		refresh()
	}, [])

	const installed = state?.installed.get(id)
	const source = installed?.source ?? null
	const entry = state?.repos.find(item => !item.internal && slash(item.url) === slash(repo.url)) ?? (isBuiltIn(repo.url) ? { url: repo.url, enabled: true } : undefined)
	const enabled = enabledNow ?? state?.enabled[id]?.enabled ?? false
	const reloadPending = pendingReload.has(id) || !!state?.enabled[id]?.pendingReload
	const update = available.get(id)
	const outdated = !!installed && update?.repo === source?.repo && !pendingReload.has(id)

	React.useEffect(() => {
		if (!state || installed) return
		findListing(repo.url, id)
			.then(found => setListing(found ?? null))
			.catch(reportError)
	}, [state === null, repo.url])

	// Valenced plans the install ahead of time, so a plugin that can't be installed says why before the button is tapped
	React.useEffect(() => {
		setBlockReason(null)
		if (!state || installed || !entry?.enabled || isLegacy(plugin)) return
		let cancelled = false
		checkInstall(repo.url, plugin, ref).then(reason => {
			if (!cancelled) setBlockReason(reason)
		})
		return () => {
			cancelled = true
		}
	}, [state === null, !!installed, entry?.enabled, repo.url, ref])

	const close = () => ActionSheetActionCreators.hideActionSheet(PLUGIN_SHEET)
	const changed = () => {
		refresh()
		onChange()
	}

	const installedRef: PluginRef = source?.held ? { type: 'version', version: installed!.version } : { type: 'channel', channel: source?.channel ?? 'latest' }
	const currentRef = installed ? installedRef : ref
	const versionText = installed
		? installed.version
		: currentRef.type === 'version'
			? currentRef.version
			: ((listing && versionOfChannel(listing, currentRef.channel)) ?? plugin.version ?? '')

	const byline = h(PluginByline, { plugin, version: versionText ? `v${versionText}` : undefined })
	const warning = [compatibilityWarning(plugin, state?.discord, blocked.get(id)?.text), ...missingDependencies(plugin, state?.installed), blockReason && `Can't be installed: ${blockReason}`].filter(Boolean).join('\n') || undefined

	const switchOrInstall = installed
		? h(FormSwitch, { value: enabled, disabled: reloadPending, onValueChange: (value: boolean) => toggle(id, value).then(done => done && (setEnabledNow(value), changed())) })
		: h(Button, {
				size: 'sm',
				text: entry?.enabled ? 'Install' : entry ? 'Enable repo' : 'Add repo',
				icon: asset('DownloadIcon'),
				loading: busy,
				disabled: !!blockReason || isLegacy(plugin),
				onPress: async () => {
					setBusy(true)
					try {
						if (entry?.enabled) {
							if (await install(repo.url, plugin, ref)) {
								close()
								onChange()
							}
						} else {
							await putRepos(slash(repo.url), true).catch(fail)
							await refresh()
							onChange()
						}
					} finally {
						setBusy(false)
					}
				},
			})

	const info = h(
		Stack,
		{ spacing: 6 },
		h(
			Stack,
			{ direction: 'horizontal', style: { alignItems: 'center' } },
			h(View, { style: { flexDirection: 'row', alignItems: 'center', flex: 1 } }, iconSlot(icon(plugin.icon, 'PuzzlePieceIcon')), h(Text, { variant: 'heading-lg/semibold', color: 'text-strong', style: { flex: 1 } }, name)),
			switchOrInstall,
		),
		h(Stack, { spacing: 4, style: { paddingLeft: ICON_INDENT } }, byline, plugin.description ? h(Text, { variant: 'text-md/medium' }, plugin.description) : null, warning ? h(WarningNote, { text: warning }) : null),
	)

	const actions = installed
		? h(
				Stack,
				{ direction: 'horizontal', justify: 'space-around', style: { paddingHorizontal: 8, paddingVertical: 16 } },
				installed.settings
					? h(IconButton, {
							variant: 'secondary',
							size: 'lg',
							icon: asset('SettingsIcon'),
							label: 'Settings',
							disabled: !enabled || reloadPending,
							onPress: () => {
								openPluginSettings(id)
								close()
							},
						})
					: null,
				h(IconButton, {
					variant: 'destructive',
					size: 'lg',
					icon: asset('TrashIcon'),
					label: 'Uninstall',
					onPress: () =>
						uninstall(plugin, dependentsOf(id, state!.installed)).then(done => {
							if (done) {
								close()
								onChange()
							}
						}),
				}),
			)
		: null

	const repoUrl = installed ? source?.repo : repo.url
	const repoName = repoUrl ? listings.get(repoUrl)?.name : null
	const offers = catalog.filter(item => listings.get(item.url)?.plugins.some(other => other.id === id))
	const canPickRepo = !installed || !!source?.repo

	const repositoryRow = h(TableRow, {
		icon: h(TableRowAssetIcon, { name: 'GlobeEarthIcon' }),
		label: 'Repository',
		subLabel: repoUrl ? formatRepository(repoUrl, repoName) : 'Sideloaded',
		arrow: canPickRepo && offers.length > 1,
		onPress:
			canPickRepo && offers.length > 1
				? () =>
						openRepoPicker({
							id,
							name,
							repo: repoUrl ?? null,
							onSelect: async url => {
								if (!installed) {
									const next = catalog.find(item => item.url === url)
									if (!next) return false
									setRepo(next)
									setListing(null)
									const found = await findListing(url, id).catch(() => undefined)
									if (found) setRef(previous => retarget(previous, found))
									return true
								}
								const found = await findListing(url, id).catch(() => undefined)
								const done = await install(url, plugin, found ? retarget(installedRef, found) : installedRef)
								if (done) changed()
								return done
							},
						})
				: undefined,
	})

	const refRow = h(TableRow, {
		icon: h(TableRowAssetIcon, { name: 'LocationIcon' }),
		label: currentRef.type === 'channel' ? 'Channel' : 'Version',
		subLabel: currentRef.type === 'channel' ? `${currentRef.channel} \u2022 v${versionText}` : `${source?.held ? 'Pinned \u2022 ' : ''}v${versionText}`,
		arrow: !!repoUrl,
		onPress: repoUrl
			? () =>
					openRefPicker({
						id,
						repo: repoUrl,
						pluginRef: currentRef,
						onSelect: async picked => {
							if (!installed) {
								setRef(picked)
								return true
							}
							const done = await install(repoUrl, plugin, picked)
							if (done) changed()
							return done
						},
					})
			: undefined,
	})

	const updates = installed
		? h(
				TableRowGroup,
				{ title: 'Updates' },
				outdated
					? h(TableRow, {
							icon: h(TableRowAssetIcon, { name: 'DownloadIcon' }),
							label: 'Update available',
							subLabel: `v${update!.installed} to v${update!.available}`,
							arrow: true,
							onPress: () => updatePlugins([{ id, name, installed: update!.installed, available: update!.available, channel: update!.channel }]).then(done => done && changed()),
						})
					: null,
				h(TableSwitchRow, {
					icon: h(TableRowAssetIcon, { IconComponent: lookupGeneratedIconComponent('RefreshIcon') }),
					label: 'Pin version',
					subLabel: source?.held ? h(Text, { color: 'text-feedback-critical', variant: 'text-xs/medium' }, `Other plugins won't be able to update if they need a newer version of ${name}`) : `Stay on v${versionText} and skip updates`,
					value: !!source?.held,
					disabled: !source,
					onValueChange: (value: boolean) => {
						setHeld(id, value)
							.then(changed)
							.catch(fail)
					},
				}),
				repositoryRow,
				refRow,
			)
		: h(TableRowGroup, { hasIcons: true, title: 'Source' }, repositoryRow, refRow)

	const requires = (plugin.requires ?? []).filter(entry => !entry.endsWith('(optional)'))
	const dependents = installed && state ? dependentsOf(id, state.installed) : []

	const advanced = h(
		TableRowGroup,
		{ hasIcons: true, title: 'Advanced' },
		h(TableRow, { icon: h(TableRowAssetIcon, { name: 'IdIcon' }), label: 'ID', subLabel: id, onPress: () => copyToClipboard(id) }),
		requires.length
			? h(TableRow, { icon: h(TableRowAssetIcon, { name: 'ListBulletsIcon' }), label: 'Dependencies', subLabel: `${name} depends on ${pluralize(requires.length, 'other plugin')}\n${requires.join('\n')}`, subLabelLineClamp: 6 })
			: null,
		dependents.length
			? h(TableRow, { icon: h(TableRowAssetIcon, { name: 'ListBulletsIcon' }), label: 'Dependents', subLabel: `${pluralize(dependents.length, 'other plugin')} depend on ${name}\n${dependents.join('\n')}`, subLabelLineClamp: 6 })
			: null,
	)

	return h(ActionSheet, null, h(Stack, { spacing: 24, style: { paddingTop: 8 } }, info, actions, updates, advanced))
}

export function openPluginSheet(props: SheetProps) {
	ActionSheetActionCreators.openLazy(Promise.resolve({ default: PluginSheet }), PLUGIN_SHEET, props)
}

type BulkProps = { items: BulkItem[]; missing: string[]; uninstall?: boolean; warning?: string; onResult: (confirmed: boolean) => void }

function BulkInstallSheet({ items, missing, uninstall, warning, onResult }: BulkProps) {
	const { View } = ReactNative
	const { BottomSheet, Button, TableRow, TableRowGroup, Text } = Design
	const settled = React.useRef(false)

	const finish = (confirmed: boolean) => {
		if (settled.current) return
		settled.current = true
		onResult(confirmed)
	}

	// closing the sheet any other way counts as cancelling
	React.useEffect(() => () => finish(false), [])

	const groups = [...new Set(items.map(item => item.repoName))].sort((a, b) => a.localeCompare(b))
	const size = items.reduce((total, item) => total + (item.size ?? 0), 0)

	const header = h(
		View,
		{ style: { gap: 12, marginBottom: 8 } },
		h(SheetHeader, { title: `${uninstall ? 'Uninstall' : 'Install'} ${pluralize(items.length, 'plugin')}?` }),
		h(
			View,
			{ style: { marginHorizontal: 16, gap: 8 } },
			h(Button, {
				text: uninstall ? 'Confirm uninstall all' : 'Confirm install all',
				variant: uninstall ? 'destructive' : 'primary',
				icon: asset(uninstall ? 'TrashIcon' : 'DownloadIcon'),
				onPress: () => {
					finish(true)
					ActionSheetActionCreators.hideActionSheet(BULK_SHEET)
				},
			}),
			size ? h(Text, { variant: 'text-sm/medium', color: 'text-muted', style: { textAlign: 'center' } }, `${formatBytes(size)} in total from ${pluralize(groups.length, 'repository').replace('repositorys', 'repositories')}`) : null,
			missing.length ? h(Text, { variant: 'text-sm/medium', color: 'text-feedback-warning', style: { textAlign: 'center' } }, `Also adds to Valenced: ${missing.join(', ')}`) : null,
			warning ? h(Text, { variant: 'text-sm/medium', color: 'text-feedback-warning', style: { textAlign: 'center' } }, warning) : null,
		),
	)

	return h(
		BottomSheet,
		{ scrollable: true, header },
		h(
			RefPage,
			{ empty: 'Nothing selected.' },
			...groups.map(group =>
				h(
					View,
					{ key: group, style: { marginBottom: 16 } },
					h(
					TableRowGroup,
					{ hasIcons: true, title: group },
					items
						.filter(item => item.repoName === group)
						.map(item =>
							h(TableRow, {
								key: item.id,
								icon: icon(item.icon, 'PuzzlePieceIcon'),
								label: item.name,
								subLabel: [[item.version ? `v${item.version}` : null, item.size ? formatBytes(item.size) : null].filter(Boolean).join(' \u2022 '), item.description].filter(Boolean).join('\n'),
								subLabelLineClamp: 3,
							}),
						),
				),
				),
			),
		),
	)
}

// resolves true only when the user confirms
export const openBulkUninstallSheet = (items: BulkItem[], warning?: string) =>
	new Promise<boolean>(done =>
		ActionSheetActionCreators.openLazy(Promise.resolve({ default: BulkInstallSheet }), BULK_SHEET, { items, missing: [], uninstall: true, warning, onResult: done }),
	)

export const openBulkInstallSheet = (items: BulkItem[], missing: string[]) =>
	new Promise<boolean>(done =>
		ActionSheetActionCreators.openLazy(Promise.resolve({ default: BulkInstallSheet }), BULK_SHEET, { items, missing, onResult: done }),
	)
