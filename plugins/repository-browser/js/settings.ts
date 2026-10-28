import { FormSwitch, SearchInput } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { React, ReactNative } from '@valenced/react'
import { FeedSection, Notice, PluginCard, RepoAvatar, RepoBadges } from './components'
import { openBulkInstallSheet, openPluginSheet } from './sheets'
import type { CardUpdate } from './components'
import {
	catalog,
	checkUpdates,
	dependentsOf,
	discordUser,
	dismiss,
	dismissAll,
	allowLarge,
	dismissRepo,
	freshAvatarEpoch,
	listings,
	missingDependencies,
	openUserProfile,
	parseAuthor,
	pendingByKind,
	repoOwner,
	save,
	setAlertMode,
	setKindMuted,
	useStore,
} from './data'
import type { SeenEntry } from './data'
import { THEMES_SETTINGS, THEME_SUPPORT, available, blocked, install, installMany, openPluginSettings, pendingReload, putRepos, readState, toggle, uninstall, updatePlugins } from './valenced'
import type { BulkItem } from './valenced'
import type { ValencedState } from './valenced'
import { ALERT_MODES, BUILT_IN_NOTE, COMMUNITY_REPO, DAY, KINDS, PAGE_SIZE, SORTS, ago, asset, compatibilityWarning, copyToClipboard, fail, friendlyError, h, hostOf, icon, inform, isBuiltIn, kindOf, modal, problemsText, recentProblems, reportError, slash } from './shared'
import type { AlertMode, AvailableUpdate, ListedPlugin, PluginKind, Repo, SortKey } from './shared'

type Hit = { repo: Repo; plugin: ListedPlugin }

// the navigation types aren't shipped with Valenced's externals, only the part used here
type ScreenNavigation = {
	isFocused(): boolean
	addListener(type: 'beforeRemove', listener: (event: { data: { action: { type: string } }; preventDefault(): void }) => void): () => void
}
type Ctx = ReturnType<typeof useBrowser>

// a switch flip stays visible until Valenced reports the new state
const toggled = new Map<string, { value: boolean; before: boolean }>()

function useBrowser() {
	const { View, BackHandler } = ReactNative
	const { Button, ContextMenu, IconButton, Text } = Design

	const data = useStore()
	const seen: Record<string, SeenEntry> = data?.seen ?? {}
	const newRepos: Record<string, number> = data?.newRepos ?? {}
	const [current, setCurrent] = React.useState<Repo | null>(null)
	const [selection, setSelection] = React.useState<Record<string, Hit>>({})
	const [bulkBusy, setBulkBusy] = React.useState(false)
	const [updatingIds, setUpdatingIds] = React.useState<string[]>([])
	const [authorNames, setAuthorNames] = React.useState<Record<string, string>>({})
	const [state, setState] = React.useState<ValencedState | null>(null)
	const [installing, setInstalling] = React.useState('')
	const [query, setQuery] = React.useState('')
	const [sort, setSort] = React.useState<SortKey>('default')
	const [limit, setLimit] = React.useState(PAGE_SIZE)
	const [kind, setKind] = React.useState<PluginKind>('plugins')
	const [repoKind, setRepoKind] = React.useState<PluginKind>('plugins')
	const [refreshing, setRefreshing] = React.useState(false)
	const [retrying, setRetrying] = React.useState('')
	const [reloadingRepo, setReloadingRepo] = React.useState(false)
	const [booting, setBooting] = React.useState(true)
	const [epoch, setEpoch] = React.useState(() => freshAvatarEpoch())
	const [, rerender] = React.useReducer((n: number) => n + 1, 0)

	const syncState = () =>
		readState()
			.then(next => {
				for (const [id, change] of toggled) if ((next.enabled[id]?.enabled ?? false) !== change.before) toggled.delete(id)
				setState(next)
			})
			.catch(reportError)

	const afterToggle = (id: string, value: boolean) => {
		toggled.set(id, { value, before: state?.enabled[id]?.enabled ?? false })
		syncState()
	}

	const refreshAll = async () => {
		if (refreshing) return
		setRefreshing(true)
		setEpoch(freshAvatarEpoch(true))
		try {
			await checkUpdates(undefined, rerender)
			await syncState()
			await save({ ack: Date.now() })
		} finally {
			setRefreshing(false)
		}
	}

	const refreshCurrent = async () => {
		if (!current || reloadingRepo) return
		setReloadingRepo(true)
		try {
			await checkUpdates([current.url], rerender)
			await syncState()
		} finally {
			setReloadingRepo(false)
		}
	}

	const loadAnyway = (repo: Repo, large: boolean) => {
		if (large) allowLarge(repo.url)
		return retry(repo)
	}

	const retry = async (repo: Repo) => {
		setRetrying(repo.url)
		try {
			await checkUpdates([repo.url], rerender)
		} finally {
			setRetrying('')
		}
	}

	const showRepo = (repo: Repo) => {
		setQuery('')
		// open on the tab the person came from, or on the first kind the repository has anything in
		setRepoKind([kind, ...KINDS.map(item => item.id)].find(id => countOf(repo, id) > 0) ?? kind)
		setCurrent(repo)
	}

	const showList = () => {
		setQuery('')
		setCurrent(null)
	}

	React.useEffect(() => {
		let mounted = true
		save({ ack: Date.now() })
		syncState()
		checkUpdates(undefined, () => mounted && rerender())
			.catch(reportError)
			.then(() => {
				if (!mounted) return
				save({ ack: Date.now() })
				setBooting(false)
			})
		return () => {
			mounted = false
		}
	}, [])

	React.useEffect(() => {
		const id = current?.discord
		if (!id) return
		let cancelled = false
		discordUser(id).then(user => {
			if (user.name && !cancelled) setAuthorNames(names => ({ ...names, [id]: user.name! }))
		})
		return () => {
			cancelled = true
		}
	}, [current, epoch])

	const selecting = Object.keys(selection).length > 0
	const navigation = React.useContext(ReactNavigationNative.NavigationContext) as ScreenNavigation | undefined

	React.useEffect(() => {
		if (!current && !selecting) return
		const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
			// a plugin's own settings can sit on top while this screen stays mounted, back belongs to that screen then
			if (navigation && !navigation.isFocused()) return false
			if (selecting) setSelection({})
			else showList()
			return true
		})
		return () => subscription.remove()
	}, [navigation, current, selecting])

	// the back arrow and the system back can reach the screen before the handler above, so a repository is also closed here
	React.useEffect(() => {
		if (!current && !selecting) return
		return navigation?.addListener('beforeRemove', event => {
			if (event.data.action.type !== 'GO_BACK' && event.data.action.type !== 'POP') return
			event.preventDefault()
			if (selecting) setSelection({})
			else showList()
		})
	}, [navigation, current, selecting])

	React.useEffect(() => setLimit(PAGE_SIZE), [query, current, sort, kind, repoKind])

	const inKind = (repo: Repo, plugin: ListedPlugin, tab: PluginKind) => kindOf(plugin, repo.kinds) === tab
	const countOf = (repo: Repo, tab: PluginKind) => (listings.get(repo.url)?.plugins ?? []).filter(plugin => inKind(repo, plugin, tab)).length

	const isEnabled = (id: string) => toggled.get(id)?.value ?? state?.enabled[id]?.enabled ?? false
	const addedRepo = (url: string) => state?.repos.find(repo => !repo.internal && slash(repo.url) === slash(url)) ?? (isBuiltIn(url) ? { url, enabled: true } : undefined)
	const repoName = (repo: Repo) => listings.get(repo.url)?.name ?? repo.url
	const alertMode = (url: string): AlertMode => data?.alerts?.[url] ?? 'news'
	const pings = pendingByKind(data, catalog)

	const pluginName = (id: string) => {
		for (const repo of catalog) {
			const listed = listings.get(repo.url)?.plugins.find(plugin => plugin.id === id)
			if (listed) return listed.name
		}
		return id
	}

	const chooseAlerts = (repo: Repo, off: PluginKind[] = data?.muted?.[repo.url] ?? []) => {
		const mode = alertMode(repo.url)
		const kinds = KINDS.filter(item => countOf(repo, item.id) > 0)
		const perKind = kinds.length > 1
		modal('Notifications', `Choose what ${repoName(repo)} adds to the red count on the settings row.${perKind ? ' Each kind it offers can also be turned off on its own.' : ''}`, Button => [
			...(Object.entries(ALERT_MODES) as [AlertMode, (typeof ALERT_MODES)[AlertMode]][]).map(([value, { button }]) =>
				h(Button, { key: value, text: button, variant: value === mode ? 'primary' : 'secondary', onPress: () => setAlertMode(repo.url, value) }),
			),
			...(perKind
				? kinds.map(item => {
						const muted = off.includes(item.id)
						const toggleKind = () => {
							setKindMuted(repo.url, item.id, !muted)
							// the popup closes on every press, so it comes back with the new state
							chooseAlerts(repo, muted ? off.filter(kind => kind !== item.id) : [...off, item.id])
						}
						return h(Button, { key: `kind:${item.id}`, text: `${item.label}: ${muted ? 'off' : 'on'}`, variant: 'tertiary', onPress: toggleKind })
					})
				: []),
		])
	}

	const runUpdate = async (ids: string[]) => {
		const list = ids.map(id => available.get(id)).filter((info): info is AvailableUpdate => !!info)
		if (!list.length || updatingIds.length) return
		setUpdatingIds(ids)
		try {
			await updatePlugins(list.map(info => ({ id: info.id, name: pluginName(info.id), installed: info.installed, available: info.available, channel: info.channel })))
		} finally {
			setUpdatingIds([])
		}
	}

	const updateFor = (repo: Repo, plugin: ListedPlugin): CardUpdate | undefined => {
		const info = available.get(plugin.id)
		if (!info || info.repo !== repo.url || !state?.installed.has(plugin.id)) return undefined
		const busy = updatingIds.includes(plugin.id)
		return { from: info.installed, to: info.available, state: pendingReload.has(plugin.id) ? 'pending' : busy ? 'busy' : 'ready', onPress: () => runUpdate([plugin.id]) }
	}

	const needle = query.trim().toLowerCase()
	const matches = (...fields: (string | undefined)[]) => !needle || fields.some(field => typeof field === 'string' && field.toLowerCase().includes(needle))
	const pluginMatches = (plugin: ListedPlugin) => matches(plugin.name, plugin.id, plugin.description, parseAuthor(plugin.author).name)

	const pluginRank = (repo: Repo, plugin: ListedPlugin) => {
		const meta = seen[repo.url]?.meta?.[plugin.id]
		if (sort === 'updated') return meta?.updated ?? 0
		if (sort === 'newest') return meta?.added ?? 0
		if (sort === 'installed') return state?.installed.has(plugin.id) ? 1 : 0
		return 0
	}

	const repoRank = (repo: Repo) => {
		const metas = Object.values(seen[repo.url]?.meta ?? {})
		if (sort === 'updated') return Math.max(0, ...metas.map(meta => Math.max(meta.updated ?? 0, meta.added ?? 0)))
		if (sort === 'newest') return Math.max(0, ...metas.map(meta => meta.added ?? 0))
		if (sort === 'installed') {
			const installedHere = (listings.get(repo.url)?.plugins ?? []).filter(plugin => state?.installed.has(plugin.id)).length
			return installedHere * 2 + (addedRepo(repo.url)?.enabled ? 1 : 0)
		}
		return 0
	}

	const sortPlugins = (hits: Hit[]) =>
		sort === 'default' ? hits : [...hits].sort((a, b) => pluginRank(b.repo, b.plugin) - pluginRank(a.repo, a.plugin) || a.plugin.name.localeCompare(b.plugin.name))

	// enables the ones that are off and installs the missing ones, together with the pack when it is being installed
	const setupThemeSupport = async (lacking: typeof THEME_SUPPORT, pack?: { repo: Repo; plugin: ListedPlugin }) => {
		const missing = lacking.filter(item => !state?.installed.has(item.id))
		for (const item of lacking.filter(item => state?.installed.has(item.id))) await toggle(item.id, true)

		const items: BulkItem[] = []
		for (const item of missing) {
			const source = catalog.map(entry => ({ entry, listed: listings.get(entry.url)?.plugins.find(listed => listed.id === item.id) })).find(found => found.listed)
			if (!source?.listed) {
				inform('Plugin Browser', `${item.name} isn't in any listed repository. Add Valenced Community Plugins (${COMMUNITY_REPO}) first.`)
				return false
			}
			items.push({ id: item.id, name: item.name, repo: source.entry.url, repoName: repoName(source.entry), version: source.listed.version })
		}
		if (pack) items.push({ id: pack.plugin.id, name: pack.plugin.name, repo: pack.repo.url, repoName: repoName(pack.repo), version: pack.plugin.version })
		return items.length ? !!(await installMany(items)) : true
	}

	// 'done' means the pack was installed together with what it needs
	const askThemeSupport = (plugin: ListedPlugin, repo?: Repo) => {
		const lacking = THEME_SUPPORT.filter(item => !state?.installed.has(item.id) || !isEnabled(item.id))
		if (!lacking.length) return Promise.resolve<'ready' | 'done' | 'cancel'>('ready')

		const names = lacking.map(item => item.name).join(' and ')
		return new Promise<'ready' | 'done' | 'cancel'>(resolve =>
			modal(
				'Required plugins',
				`${plugin.name} is applied from Settings > Themes, which needs ${names} installed and enabled.`,
				Button => [
					h(Button, { key: 'fix', text: 'Install required', variant: 'primary', onPress: () =>
							setupThemeSupport(lacking, repo && { repo, plugin })
								.then(ok => resolve(ok ? 'done' : 'cancel'))
								.catch(error => {
									fail(error, `set up Themes for ${plugin.name}`)
									resolve('cancel')
								}),
					}),
					...(repo ? [h(Button, { key: 'skip', text: 'Install anyway', variant: 'secondary', onPress: () => resolve('ready') })] : []),
					h(Button, { key: 'no', text: 'Cancel', variant: 'secondary', onPress: () => resolve('cancel') }),
				],
				() => resolve('cancel'),
			),
		)
	}

	const installPlugin = async (repo: Repo, plugin: ListedPlugin) => {
		setInstalling(plugin.id)
		try {
			const support = kindOf(plugin, repo.kinds) === 'plugins' ? 'ready' : await askThemeSupport(plugin, repo)
			if (support === 'ready') await install(repo.url, plugin)
		} catch (e) {
			fail(e, `install ${plugin.name}`)
		} finally {
			setInstalling('')
			syncState()
		}
	}

	const applyPack = async (plugin: ListedPlugin) => {
		try {
			if ((await askThemeSupport(plugin)) === 'ready') openPluginSettings(THEMES_SETTINGS)
		} catch (e) {
			fail(e, `apply ${plugin.name}`)
		}
	}

	const removePlugin = (plugin: ListedPlugin) =>
		uninstall(plugin, state ? dependentsOf(plugin.id, state.installed) : []).then(done => {
			if (done) syncState()
		})

	const pluginActions = (repo: Repo, plugin: ListedPlugin, fromSearch: boolean) => {
		if (!state) return []
		const installed = state.installed.get(plugin.id)
		const repoEntry = addedRepo(repo.url)

		if (installed) {
			const on = isEnabled(plugin.id)
			const settingsReady = on && !toggled.has(plugin.id) && !state.enabled[plugin.id]?.pendingReload
			return [
				h(IconButton, {
					key: 'remove',
					size: 'sm',
					variant: 'secondary',
					icon: asset('TrashIcon'),
					onPress: () => removePlugin(plugin),
				}),
				installed.settings &&
					h(IconButton, { key: 'settings', size: 'sm', variant: 'secondary', icon: asset('SettingsIcon'), disabled: !settingsReady, onPress: () => openPluginSettings(plugin.id) }),
				kindOf(plugin, repo.kinds) !== 'plugins' && h(Button, { key: 'apply', text: 'Apply', size: 'sm', variant: 'primary', disabled: !settingsReady, onPress: () => applyPack(plugin) }),
				h(FormSwitch, {
					key: 'enabled',
					value: on,
					onValueChange: (value: boolean) => toggle(plugin.id, value).then(done => done && afterToggle(plugin.id, value)),
				}),
			]
		}

		if (repoEntry?.enabled) {
			return [
				h(Button, {
					key: 'install',
					text: 'Install',
					size: 'sm',
					icon: asset('DownloadIcon'),
					loading: installing === plugin.id,
					onPress: () => installPlugin(repo, plugin),
				}),
			]
		}

		return [
			h(Button, {
				key: 'repo',
				text: fromSearch ? 'Open repo' : repoEntry ? 'Enable repo' : 'Add repo',
				size: 'sm',
				variant: 'secondary',
				onPress: () => (fromSearch ? showRepo(repo) : putRepos(slash(repo.url), true).then(syncState).catch(fail)),
			}),
		]
	}

	const toggleSelect = (repo: Repo, plugin: ListedPlugin) =>
		setSelection(current => {
			const next = { ...current }
			if (next[plugin.id]?.repo.url === repo.url) delete next[plugin.id]
			else next[plugin.id] = { repo, plugin }
			return next
		})

	const installSelected = async () => {
		if (bulkBusy) return
		const items: BulkItem[] = (Object.values(selection) as Hit[])
			.filter(({ plugin }) => !state?.installed.has(plugin.id))
			.map(({ repo, plugin }) => ({
				id: plugin.id,
				name: plugin.name,
				repo: repo.url,
				repoName: repoName(repo),
				version: plugin.version,
				size: plugin.size,
				description: plugin.description,
				icon: plugin.icon,
			}))
		if (!items.length) {
			setSelection({})
			return
		}

		const missing = [...new Set(items.filter(item => !addedRepo(item.repo)?.enabled).map(item => item.repoName))]
		if (!(await openBulkInstallSheet(items, missing))) return

		setBulkBusy(true)
		try {
			if (await installMany(items)) setSelection({})
			await syncState()
		} finally {
			setBulkBusy(false)
		}
	}

	const pluginCard = (repo: Repo, plugin: ListedPlugin, fromSearch = false) => {
		const installed = state?.installed.has(plugin.id) ?? false
		const version = state?.installed.get(plugin.id)?.version ?? plugin.version
		const origin = fromSearch ? `${kindInfoOf(kindOf(plugin, repo.kinds)).label} from ${repoName(repo)}${addedRepo(repo.url)?.enabled ? '' : ' \u2022 repository not added'}` : undefined
		const selectable = selecting && !installed
		return h(PluginCard, {
			key: `${repo.url}#${plugin.id}`,
			plugin,
			version,
			origin,
			actions: pluginActions(repo, plugin, fromSearch),
			update: updateFor(repo, plugin),
			warning: [compatibilityWarning(plugin, state?.discord, blocked.get(plugin.id)?.text), ...missingDependencies(plugin, state?.installed)].filter(Boolean).join('\n') || undefined,
			selectable,
			selected: selection[plugin.id]?.repo.url === repo.url,
			onPress: selectable ? () => toggleSelect(repo, plugin) : () => openPluginSheet({ repo, plugin, onChange: syncState }),
			onLongPress: installed ? undefined : () => toggleSelect(repo, plugin),
		})
	}

	const moreButton = (total: number) =>
		total > limit ? h(Button, { key: 'more', text: `Show more (${total - limit})`, variant: 'secondary', onPress: () => setLimit(count => count + PAGE_SIZE) }) : null

	const controls = () =>
		h(
			View,
			{ key: 'controls', style: { flexDirection: 'row', alignItems: 'center' } },
			h(
				View,
				{ style: { flex: 1 } },
				h(SearchInput, { value: query, onChange: setQuery, isClearable: true, placeholder: current ? 'Search this repository' : 'Search plugins and repositories' }),
			),
			!current &&
				h(
					View,
					{ style: { marginLeft: 8 } },
					h(IconButton, { size: 'md', variant: 'secondary', icon: asset('RetryIcon'), loading: refreshing, disabled: refreshing, onPress: refreshAll }),
				),
			h(
				View,
				{ style: { marginLeft: 8 } },
				h(
					ContextMenu,
					{
						title: 'Sort by',
						items: [
							Object.entries(SORTS).map(([key, label]) => ({
								label,
								IconComponent: key === sort ? () => icon('CheckmarkLargeIcon', 'CheckIcon') : undefined,
								action: () => setSort(key as SortKey),
							})),
						],
					},
					(props: any) => h(IconButton, { ...props, size: 'md', variant: sort !== 'default' ? 'primary' : 'secondary', icon: asset('FiltersHorizontalIcon') }),
				),
			),
		)

	const sortNote = (ranks: number[]) => {
		if (sort === 'default') return null
		const noHistory = (sort === 'updated' || sort === 'newest') && !ranks.some(Boolean)
		return h(
			View,
			{ key: 'sorted', style: { flexDirection: 'row', alignItems: 'center' } },
			h(Text, { variant: 'text-sm/medium', color: 'text-muted', style: { flex: 1 } }, `Sorted by ${SORTS[sort]}${noHistory ? ' (no history yet, showing A-Z)' : ''}`),
			h(Button, { text: 'Reset', size: 'sm', variant: 'tertiary', onPress: () => setSort('default') }),
		)
	}

	const noMatches = () => h(Text, { key: 'none', variant: 'text-md/medium' }, `Nothing matches "${query.trim()}".`)

	return {
		seen,
		newRepos,
		current,
		kind,
		setKind,
		repoKind,
		setRepoKind,
		pings,
		inKind,
		countOf,
		selection,
		selecting,
		bulkBusy,
		setSelection,
		installSelected,
		updatingIds,
		authorNames,
		state,
		installing,
		sort,
		setSort,
		limit,
		refreshing,
		retrying,
		reloadingRepo,
		booting,
		epoch,
		needle,
		syncState,
		afterToggle,
		refreshAll,
		refreshCurrent,
		retry,
		loadAnyway,
		showRepo,
		showList,
		isEnabled,
		addedRepo,
		repoName,
		alertMode,
		chooseAlerts,
		runUpdate,
		matches,
		pluginMatches,
		pluginRank,
		repoRank,
		sortPlugins,
		installPlugin,
		removePlugin,
		pluginCard,
		moreButton,
		controls,
		sortNote,
		noMatches,
	}
}

const kindInfoOf = (tab: PluginKind) => KINDS.find(item => item.id === tab)!
const pluralKind = (tab: PluginKind, count: number) => `${count} ${count === 1 ? kindInfoOf(tab).singular : kindInfoOf(tab).plural}`

function feed(b: Ctx, tab: PluginKind, type: 'news' | 'updates', title: string) {
	const { TableRow, TableRowGroup } = Design
	const items = catalog
		.flatMap(repo => Object.entries<any>(b.seen[repo.url]?.[type] ?? {}).map(([id, value]) => ({ repo, id, value, at: type === 'news' ? (value as number) : value.at })))
		.filter(item => {
			const listed = listings.get(item.repo.url)?.plugins.find(plugin => plugin.id === item.id)
			if (!listed || !b.inKind(item.repo, listed, tab)) return false
			if (type === 'news') return true
			return Date.now() - item.at < DAY && !b.seen[item.repo.url].news?.[item.id]
		})
		.sort((a, c) => c.at - a.at)
	if (!items.length) return null

	const rows = items.map(({ repo, id, value, at }) => {
		const listing = listings.get(repo.url)!
		const plugin = listing.plugins.find(item => item.id === id)!
		const note = type === 'news' ? `New in ${listing.name}` : `Updated in ${listing.name}\n${value.from} to ${value.to}`
		return h(TableRow, {
			key: `${type}:${repo.url}#${id}`,
			icon: icon(plugin.icon, 'PuzzlePieceIcon'),
			label: plugin.name,
			subLabel: `${note}\n${ago(at)}`,
			subLabelLineClamp: 3,
			arrow: true,
			onPress: () => {
				dismiss(type, repo.url, id)
				b.showRepo(repo)
			},
		})
	})
	return h(FeedSection, { key: type, title, onAction: () => dismissAll(type) }, h(TableRowGroup, null, rows))
}

function updatesSection(b: Ctx, tab: PluginKind) {
	const { TableRow, TableRowGroup } = Design
	const items = [...available.values()].filter(info => {
		const repo = catalog.find(item => item.url === info.repo)
		const listed = repo && listings.get(repo.url)?.plugins.find(plugin => plugin.id === info.id)
		return b.state?.installed.has(info.id) && !pendingReload.has(info.id) && !!listed && b.inKind(repo, listed, tab)
	})
	if (!items.length) return null

	const rows = items.map(info => {
		const repo = catalog.find(item => item.url === info.repo)!
		const listed = listings.get(repo.url)?.plugins.find(plugin => plugin.id === info.id)
		return h(TableRow, {
			key: `update:${info.id}`,
			icon: icon(listed?.icon, 'PuzzlePieceIcon'),
			label: listed?.name ?? info.id,
			subLabel: `${info.installed} to ${info.available}\nfrom ${b.repoName(repo)}`,
			subLabelLineClamp: 2,
			arrow: true,
			onPress: listed ? () => openPluginSheet({ repo, plugin: listed, onChange: b.syncState }) : undefined,
		})
	})

	return h(
		FeedSection,
		{
			key: 'available',
			title: 'Updates available',
			action: 'Update all',
			variant: 'primary',
			loading: b.updatingIds.length > 0,
			onAction: () => b.runUpdate(items.map(info => info.id)),
		},
		h(TableRowGroup, null, rows),
	)
}

function repoRow(b: Ctx, repo: Repo, tab?: PluginKind) {
	const { View } = ReactNative
	const { Button, TableRow, Text } = Design
	const listing = listings.get(repo.url)
	const failed = listing?.err || listing?.stale

	let subLabel = 'Loading...'
	if (listing?.err) subLabel = friendlyError(listing.err)
	else if (listing?.stale) subLabel = `Couldn't refresh (${friendlyError(listing.stale)}). Showing ${listing.saved ? `the copy saved ${ago(listing.saved)}` : 'earlier data'}`
	else if (listing) subLabel = [listing.description, hostOf(repo.url)].filter(Boolean).join('\n')
	if (repo.builtIn && listing && !failed) subLabel = BUILT_IN_NOTE
	if (b.newRepos[repo.url]) subLabel = `New repository\n${subLabel}`

	let trailing
	if (failed) trailing = h(Button, { text: listing?.tooLarge ? 'Load anyway' : 'Retry', size: 'sm', variant: 'secondary', loading: b.retrying === repo.url, onPress: () => b.loadAnyway(repo, !!listing?.tooLarge) })
	else if (listing) trailing = h(TableRow.TrailingText, { text: tab ? `${kindInfoOf(tab).label} \u00b7 ${b.countOf(repo, tab)}` : `${KINDS.reduce((sum, item) => sum + b.countOf(repo, item.id), 0)} listed` })

	const lines = b.newRepos[repo.url] ? 4 : 3
	const own = repo.badges ?? []
	const badges = [...own, ...KINDS.filter(item => item.id !== 'plugins' && b.countOf(repo, item.id) > 0 && !own.some(label => label.toLowerCase() === item.label.toLowerCase())).map(item => item.label)]
	const details = badges.length
		? h(
				View,
				null,
				h(Text, { variant: 'text-sm/medium', color: 'text-muted', numberOfLines: lines }, subLabel),
				h(View, { style: { marginTop: 6 } }, h(RepoBadges, { badges })),
			)
		: subLabel

	return h(TableRow, {
		key: repo.url,
		icon: h(RepoAvatar, { repo, listing, epoch: b.epoch }),
		label: b.repoName(repo),
		subLabel: details,
		labelLineClamp: 1,
		subLabelLineClamp: lines,
		trailing,
		arrow: true,
		onPress: () => {
			dismissRepo(repo.url)
			b.showRepo(repo)
		},
	})
}

function emptyList(b: Ctx) {
	const { Button, Stack, Text } = Design
	const waiting = b.booting || b.refreshing
	return h(
		Stack,
		{ key: 'empty', spacing: 12 },
		h(Text, { variant: 'text-md/medium', color: 'text-muted' }, waiting ? 'Loading repositories...' : "Couldn't load the repository list. Check your connection and try again. If it keeps failing, the list itself may be broken."),
		!waiting && h(Button, { text: 'Try again', size: 'md', variant: 'secondary', onPress: b.refreshAll }),
	)
}

function MainPage(b: Ctx, tab: PluginKind) {
	const { TableRow, TableRowGroup, Text } = Design
	const { sort } = b

	// a repository stays visible while it loads or fails so it can be retried
	const hasKind = (repo: Repo) => {
		const listing = listings.get(repo.url)
		return !listing || !!listing.err || !!listing.stale || b.countOf(repo, tab) > 0
	}
	const shown = catalog.filter(hasKind)
	const isNew = (repo: Repo) => (b.newRepos[repo.url] ? 1 : 0)
	const sorted = sort === 'default' ? [...shown].sort((x, y) => isNew(y) - isNew(x)) : shown.sort((x, y) => b.repoRank(y) - b.repoRank(x) || b.repoName(x).localeCompare(b.repoName(y)))
	// the built in repository stays at the end whatever the sort is
	const repos = [...sorted.filter(repo => !repo.builtIn), ...sorted.filter(repo => repo.builtIn)]

	return [
		h(Notice, { key: 'notice' }),
		b.sortNote(repos.map(b.repoRank)),
		updatesSection(b, tab),
		feed(b, tab, 'news', `New ${kindInfoOf(tab).plural}`),
		feed(b, tab, 'updates', 'Recently updated'),
		catalog.length ? null : emptyList(b),
		catalog.length && !repos.length ? h(Text, { key: 'nokind', variant: 'text-md/medium', color: 'text-muted' }, `No ${kindInfoOf(tab).plural} in the listed repositories yet.`) : null,
		repos.length ? h(TableRowGroup, { key: 'all', title: 'Repositories', description: `${repos.length} repositories` }, repos.map(repo => repoRow(b, repo, tab))) : null,
		recentProblems().length
			? h(
					TableRowGroup,
					{ key: 'problems', title: 'Diagnostics' },
					h(TableRow, { label: `Recent problems (${recentProblems().length})`, subLabel: 'Copy them to share when something breaks', arrow: true, onPress: () => copyToClipboard(problemsText()) }),
				)
			: null,
	]
}

// search looks through every kind, so it replaces the tabs while there is a query
function SearchPage(b: Ctx) {
	const { Stack, TableRowGroup, Text } = Design
	const hits = b.sortPlugins(catalog.flatMap(repo => (listings.get(repo.url)?.plugins ?? []).filter(plugin => b.pluginMatches(plugin)).map(plugin => ({ repo, plugin }))))
	const repos = catalog.filter(repo => b.matches(b.repoName(repo), listings.get(repo.url)?.description, repo.url))
	if (!hits.length && !repos.length) return [b.noMatches()]

	return [
		b.sortNote(hits.map(hit => b.pluginRank(hit.repo, hit.plugin))),
		hits.length
			? h(
					Stack,
					{ key: 'hits', spacing: 12 },
					h(Text, { variant: 'text-md/semibold', color: 'text-muted' }, `${hits.length} found`),
					...hits.slice(0, b.limit).map(hit => b.pluginCard(hit.repo, hit.plugin, true)),
					b.moreButton(hits.length),
				)
			: null,
		repos.length ? h(TableRowGroup, { key: 'repos', title: 'Repositories' }, repos.map(repo => repoRow(b, repo))) : null,
	]
}

function RepoPage(b: Ctx, repo: Repo) {
	const { Button, Stack, TableRow, TableRowGroup, TableSwitchRow, Text } = Design
	const { Linking } = ReactNative
	const tab = b.repoKind
	const listing = listings.get(repo.url)
	const entry = b.addedRepo(repo.url)
	const visible = b.sortPlugins((listing?.plugins ?? []).filter(plugin => b.inKind(repo, plugin, tab) && b.pluginMatches(plugin)).map(plugin => ({ repo, plugin })))

	let lastUpdated: string | undefined
	if (!b.reloadingRepo) {
		if (listing?.err) lastUpdated = friendlyError(listing.err)
		else if (listing?.at) lastUpdated = `${listing.stale ? 'Last updated' : 'Updated'} ${ago(listing.at)}`
	}

	const header = h(TableRowGroup, { key: 'info', title: listing?.name ?? repo.url, description: [hostOf(repo.url), listing?.description, repo.builtIn ? BUILT_IN_NOTE : undefined].filter(Boolean).join('\n') }, [
		h(TableRow, { key: 'back', label: 'Back', icon: icon('ArrowLargeLeftIcon'), onPress: b.showList }),
		h(TableRow, {
			key: 'author',
			label: (repo.discord && b.authorNames[repo.discord]) || repoOwner(repo),
			subLabel: 'Author',
			icon: h(RepoAvatar, { repo, listing, epoch: b.epoch, person: true }),
			arrow: !!repo.discord,
			onPress: repo.discord ? () => openUserProfile(repo.discord!) : undefined,
		}),
		repo.builtIn
			? h(TableRow, { key: 'repo', label: 'Built in', subLabel: 'Always on, it can\'t be turned off or removed', icon: icon('CircleCheckIcon') })
			: entry
				? h(TableSwitchRow, {
					key: 'repo',
					label: entry.enabled ? 'Repository enabled' : 'Repository disabled',
					subLabel: entry.enabled ? 'Added to Valenced' : 'Turn on to install its plugins',
					icon: icon(entry.enabled ? 'CircleCheckIcon' : 'CircleXIcon'),
					value: entry.enabled,
					onValueChange: (value: boolean) => putRepos(entry.url, value).then(b.syncState).catch(fail),
				})
			: h(TableRow, {
					key: 'repo',
					label: 'Add to Valenced',
					subLabel: repo.url,
					icon: icon('DownloadIcon'),
					arrow: true,
					onPress: () => putRepos(slash(repo.url), true).then(b.syncState).catch(fail),
				}),
		h(TableRow, {
			key: 'link',
			label: repo.source ? 'Source' : 'Website',
			subLabel: repo.source ?? repo.url,
			icon: icon(repo.source ? 'PaperIcon' : 'GlobeEarthIcon'),
			arrow: true,
			onPress: () => Linking.openURL(repo.source ?? repo.url),
		}),
		h(TableRow, {
			key: 'alerts',
			label: 'Notifications',
			subLabel: ALERT_MODES[b.alertMode(repo.url)].summary,
			icon: icon('BellIcon'),
			arrow: true,
			onPress: () => b.chooseAlerts(repo),
		}),
		h(TableRow, {
			key: 'refresh',
			label: b.reloadingRepo ? 'Refreshing...' : 'Refresh',
			subLabel: lastUpdated,
			icon: icon('RetryIcon'),
			disabled: b.reloadingRepo,
			onPress: b.refreshCurrent,
		}),
	])

	if (listing?.err) {
		const message = `Failed to load: ${friendlyError(listing.err)}. Use Refresh above to try again.`
		return [
			header,
			h(Text, { key: 'err', variant: 'text-md/medium' }, message),
			listing.tooLarge ? h(Button, { key: 'large', text: 'Load anyway', variant: 'secondary', onPress: () => b.loadAnyway(repo, true) }) : null,
		]
	}

	const others = KINDS.filter(item => item.id !== tab && b.countOf(repo, item.id) > 0)
	const switcher = others.length
		? h(
				TableRowGroup,
				{ key: 'kinds', title: 'Also in this repository' },
				others.map(item =>
					h(TableRow, { key: item.id, label: pluralKind(item.id, b.countOf(repo, item.id)), subLabel: `Show its ${item.plural}`, arrow: true, onPress: () => b.setRepoKind(item.id) }),
				),
			)
		: null

	return [
		header,
		switcher,
		h(
			Stack,
			{ key: 'plugins', spacing: 12 },
			h(Text, { variant: 'text-md/semibold', color: 'text-muted' }, `This repository comes with ${pluralKind(tab, b.countOf(repo, tab))}`),
			!entry?.enabled && h(Text, { key: 'hint', variant: 'text-sm/medium', color: 'text-muted' }, 'Add this repository to Valenced to install its plugins.'),
			b.sortNote(visible.map(item => b.pluginRank(item.repo, item.plugin))),
			b.needle && !visible.length && b.noMatches(),
			...visible.slice(0, b.limit).map(item => b.pluginCard(item.repo, item.plugin)),
			b.moreButton(visible.length),
		),
	]
}

function SelectionBar(b: Ctx) {
	const { View } = ReactNative
	const { Button, Card, Stack, Text } = Design
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()
	if (!b.selecting) return null

	const count = Object.keys(b.selection).length
	return h(
		View,
		{ style: { paddingHorizontal: 12, paddingBottom: 12 + bottom } },
		h(
			Card,
			{ border: 'strong', style: { padding: 12 } },
			h(
				Stack,
				{ spacing: 8 },
				h(Text, { variant: 'text-md/semibold' }, `${count} selected`),
				h(Button, { text: 'Install all', variant: 'primary', icon: asset('DownloadIcon'), loading: b.bulkBusy, disabled: b.bulkBusy, onPress: b.installSelected }),
				b.current
					? h(Button, { text: 'Select more from other repositories', variant: 'secondary', disabled: b.bulkBusy, onPress: b.showList })
					: h(Text, { variant: 'text-sm/medium', color: 'text-muted' }, 'Open another repository to add more plugins.'),
				h(Button, { text: 'Clear selection', variant: 'tertiary', disabled: b.bulkBusy, onPress: () => b.setSelection({}) }),
			),
		),
	)
}

export function Browser() {
	const { ScrollView, View } = ReactNative
	const { SegmentedControl, SegmentedControlPages, Stack, useSegmentedControlState } = Design
	const b = useBrowser()
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()
	const contentStyle = { padding: 16, paddingBottom: 16 + (b.selecting ? 0 : bottom) }
	const [pageWidth, setPageWidth] = React.useState(0)
	const active = Math.max(0, KINDS.findIndex(item => item.id === b.kind))

	// tabs only belong to the main list, an open repository or a search replaces them
	const tabbed = !b.current && !b.needle

	// only the open tab and its neighbours are built, a swipe only ever reaches those
	const items = KINDS.map(({ id, label }, index) => ({
		id,
		label: b.pings[id] ? `${label} \u2022` : label,
		page: tabbed && Math.abs(index - active) <= 1 ? h(ScrollView, { style: { flex: 1 } }, h(Stack, { spacing: 16, style: contentStyle }, MainPage(b, id))) : null,
	}))

	const tabs = useSegmentedControlState({
		items,
		pageWidth,
		defaultIndex: active,
		onSetActiveIndex: (index: number) => b.setKind(KINDS[index].id),
		onPageChange: (index: number) => b.setKind(KINDS[index].id),
	})

	return h(
		View,
		{ style: { flex: 1 } },
		h(View, { style: { paddingHorizontal: 16, paddingTop: 16, gap: 12 } }, b.controls(), tabbed && h(SegmentedControl, { state: tabs })),
		tabbed
			? h(View, { style: { flex: 1 }, onLayout: (e: any) => setPageWidth(e.nativeEvent.layout.width) }, h(SegmentedControlPages, { state: tabs }))
			: h(ScrollView, { style: { flex: 1 } }, h(Stack, { spacing: 16, style: contentStyle }, b.current ? RepoPage(b, b.current) : SearchPage(b))),
		SelectionBar(b),
	)
}
