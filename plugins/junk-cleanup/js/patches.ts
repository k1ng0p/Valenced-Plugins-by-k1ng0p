import { AssetsRegistry } from '@valenced/assets'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { SettingListRenderer } from '@valenced/discord/modules/settings/renderer'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { getModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { before, instead } from '@valenced/patcher'
import { React, ReactJSXRuntime } from '@valenced/react'
import { insteadJSX } from '@valenced/react/jsx-runtime'
import { isOn, ui } from './options'
import type { PluginCleanupApi } from '@valenced/plugins/types'
import type { OptionKey } from './options'

const DEBUG: boolean = false

export interface Env {
	cleanup: PluginCleanupApi
	fail: (error: unknown) => void
	live: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runs `fn` while the plugin is running, sending failures to `plugin.reportError` */
function safely(env: Env, fn: () => void) {
	if (!env.live) return
	try {
		fn()
	} catch (e) {
		env.fail(e)
	}
}

function whenPath<T = any>(env: Env, path: string, fn: (ns: T) => void) {
	env.cleanup(
		getModuleWithImportedPath<T>(path, (ns: T) => safely(env, () => fn(ns))),
	)
}

function whenNamed<T = any>(env: Env, name: string, fn: (ns: T) => void) {
	env.cleanup(
		getModules(withName(name), (ns: any) => safely(env, () => fn(ns)), {
			returnNamespace: true,
		}),
	)
}

function whenProps<T = any>(env: Env, props: string[], fn: (ns: T) => void) {
	const filter = (
		withProps as (...p: string[]) => ReturnType<typeof withProps>
	)(...props)
	env.cleanup(
		getModules(filter, (ns: any) => safely(env, () => fn(ns)), {
			returnNamespace: true,
		}),
	)
}

/** Swaps `host[key]` so its result passes through `transform` */
function rewrite(
	env: Env,
	host: any,
	key: string,
	transform: (result: any, args: any[]) => any,
) {
	if (typeof host?.[key] !== 'function') return
	env.cleanup(
		instead(host, key, function (this: unknown, args: any[], original: any) {
			return transform(Reflect.apply(original, this, args), args)
		}),
	)
}

/** Renders nothing in place of `target` while the option is on */
function mute(env: Env, target: any, option: OptionKey) {
	if (!target) return
	env.cleanup(
		insteadJSX(target, (args, jsx) =>
			isOn(option) ? null : jsx(args[0], args[1], args[2]),
		),
	)
}

/** A module's component: the default export, or the namespace itself */
function componentOf(ns: any): any {
	const exported = ns?.default ?? ns
	return typeof exported === 'function' ||
		(exported && typeof exported === 'object')
		? exported
		: undefined
}

// ---------------------------------------------------------------------------
// Profiles and chat
// ---------------------------------------------------------------------------

const WISHLIST_TAB_IDS = new Set(['wishlist', 'board', 'activity'])

function profileAndChat(env: Env) {
	const emptyIfOn = (option: OptionKey) => (r: any) => (isOn(option) ? null : r)

	// modules/collectibles/avatar_decorations/*, design/void/Avatar/native/Avatar.tsx
	whenPath(
		env,
		'modules/collectibles/avatar_decorations/useAvatarDecoration.tsx',
		ns => {
			rewrite(env, ns, 'useAvatarDecoration', emptyIfOn('avatarDecorations'))
			rewrite(env, ns, 'getAvatarDecoration', emptyIfOn('avatarDecorations'))
		},
	)
	whenPath(
		env,
		'modules/collectibles/avatar_decorations/AvatarDecorationUtils.tsx',
		ns =>
			rewrite(
				env,
				ns,
				'parseAvatarDecorationData',
				emptyIfOn('avatarDecorations'),
			),
	)
	whenPath(env, 'design/void/Avatar/native/Avatar.tsx', ns => {
		const avatar = componentOf(ns)
		if (!avatar) return
		env.cleanup(
			insteadJSX(avatar, ([type, props, key]: any[], jsx) =>
				isOn('avatarDecorations') && props?.avatarDecoration != null
					? jsx(type, { ...props, avatarDecoration: null }, key)
					: jsx(type, props, key),
			),
		)
	})

	// Nameplates
	whenProps(env, ['useNameplate'], ns =>
		rewrite(env, ns, 'useNameplate', emptyIfOn('nameplates')),
	)
	whenNamed(env, 'Nameplate', ns => mute(env, componentOf(ns), 'nameplates'))

	// Profile effects and frames
	whenNamed(env, 'useProfileEffect', ns =>
		rewrite(env, ns, 'default', emptyIfOn('profileEffects')),
	)
	whenNamed(env, 'WrappedProfileEffect', ns =>
		mute(env, componentOf(ns), 'profileEffects'),
	)
	whenNamed(env, 'useProfileFrame', ns =>
		rewrite(env, ns, 'default', emptyIfOn('profileFrames')),
	)

	// Badges
	whenNamed(env, 'useBadges', ns =>
		rewrite(env, ns, 'default', r => (isOn('badges') ? [] : r)),
	)

	// Server tags: modules/guild_tag/*
	whenPath(env, 'modules/guild_tag/GuildTagUtils.tsx', ns => {
		rewrite(env, ns, 'useShouldDisplayGuildTag', r =>
			isOn('serverTags') ? false : r,
		)
		rewrite(env, ns, 'shouldDisplayGuildTag', r =>
			isOn('serverTags') ? false : r,
		)
		rewrite(env, ns, 'getUserPrimaryGuild', r =>
			isOn('serverTags') && r
				? { ...r, tag: null, badge: null, guildId: null }
				: r,
		)
	})
	whenPath(env, 'modules/guild_tag/native/GuildTag.tsx', ns => {
		for (const target of [
			componentOf(ns),
			ns?.GuildTagBadge,
			ns?.BaseGuildTagChiplet,
		])
			mute(env, target, 'serverTags')
	})
	whenPath(env, 'modules/guild_tag/native/VoiceGuildTag.tsx', ns =>
		mute(env, componentOf(ns), 'serverTags'),
	)

	// Display name styles
	whenNamed(env, 'useDisplayNameStyles', ns =>
		rewrite(env, ns, 'default', emptyIfOn('displayNameStyles')),
	)
	whenNamed(env, 'createMessageContent', ns =>
		rewrite(env, ns, 'default', r =>
			isOn('displayNameStyles') && r?.displayNameStyles != null
				? { ...r, displayNameStyles: null }
				: r,
		),
	)

	// DM happening-now cards
	whenProps(env, ['getMessagesItemHappeningNowHeight'], ns => {
		rewrite(env, ns.default, 'type', emptyIfOn('dmActivityCards'))
		rewrite(env, ns, 'getMessagesItemHappeningNowHeight', r =>
			isOn('dmActivityCards') ? 0 : r,
		)
	})

	// Wishlist and board tabs:
	// design/components/SegmentedControl/native/SegmentedControlState.native.tsx
	// design/components/Tabs/native/Tabs.native.tsx
	whenPath(
		env,
		'design/components/SegmentedControl/native/SegmentedControlState.native.tsx',
		ns => {
			if (typeof ns?.useSegmentedControlState !== 'function') return
			env.cleanup(
				instead(
					ns,
					'useSegmentedControlState',
					(args: any[], original: any) => {
						const items = args[0]?.items
						const affected =
							isOn('wishlist') &&
							Array.isArray(items) &&
							items.some(i => WISHLIST_TAB_IDS.has(i?.id))
						return affected
							? original({
									...args[0],
									items: items.filter((i: any) => !WISHLIST_TAB_IDS.has(i?.id)),
								})
							: original(...args)
					},
				),
			)
		},
	)
	// One tab left makes the whole bar pointless
	whenPath(env, 'design/components/Tabs/native/Tabs.native.tsx', ns => {
		if (typeof ns?.Tabs !== 'function') return
		env.cleanup(
			insteadJSX(ns.Tabs, (args, jsx) => {
				const items = (args[1] as any)?.state?.items
				return isOn('wishlist') && Array.isArray(items) && items.length <= 1
					? null
					: jsx(args[0], args[1], args[2])
			}),
		)
	})
}

// ---------------------------------------------------------------------------
// You tab, quest dock and boost bar
// ---------------------------------------------------------------------------

/** Hides a module's component; `rules` limit it to specific JSX keys */
function muteKeyed(
	env: Env,
	path: string,
	rules: Array<{ jsxKey?: string; option: OptionKey }>,
) {
	whenPath(env, path, ns => {
		const target = componentOf(ns)
		if (!target) return
		env.cleanup(
			insteadJSX(target, (args, jsx) =>
				rules.some(
					r =>
						(r.jsxKey === undefined || args[2] === r.jsxKey) && isOn(r.option),
				)
					? null
					: jsx(args[0], args[1], args[2]),
			),
		)
	})
}

function questsAndShop(env: Env) {
	muteKeyed(env, 'modules/quests/native/QuestDock/QuestDock.tsx', [
		{ option: 'questDock' },
	])
	muteKeyed(env, 'modules/main_tabs_v2/native/tabs/you/YouScreenNavIcon.tsx', [
		{ jsxKey: 'quests', option: 'youQuests' },
		{ jsxKey: 'nitro', option: 'youNitro' },
	])
	muteKeyed(
		env,
		'modules/main_tabs_v2/native/tabs/you/YouScreenNavIconNitroSubscriber.tsx',
		[{ jsxKey: 'nitro-subscriber', option: 'youNitro' }],
	)
	muteKeyed(
		env,
		'modules/collectibles/native/CollectiblesShopEntryButton.tsx',
		[{ jsxKey: 'shop', option: 'youShop' }],
	)
	muteKeyed(env, 'modules/virtual_currency/native/BalanceWidgetMenu.tsx', [
		{ option: 'youOrbs' },
	])

	// modules/guild_sidebar/useGuildActionRows.tsx
	whenPath(env, 'modules/guild_sidebar/useGuildActionRows.tsx', ns =>
		rewrite(env, ns, 'default', rows =>
			isOn('boostGoal') && Array.isArray(rows)
				? rows.filter(row => row !== 'guild-premium-progress-bar')
				: rows,
		),
	)
}

// ---------------------------------------------------------------------------
// Settings page (rows resolved from the settings tree)
// ---------------------------------------------------------------------------

const NITRO_SETTING_KEYS = new Set([
	'PREMIUM',
	'PREMIUM_MANAGE_SUBSCRIPTIONS',
	'PREMIUM_MANAGE_PLAN',
	'PREMIUM_PLAN_SELECT',
	'PREMIUM_GIFTING',
	'PREMIUM_GUILD_BOOSTING',
	'PREMIUM_RESTORE_SUBSCRIPTION',
	'GUILD_ROLE_SUBSCRIPTIONS',
	'GUILD_ROLE_SUBSCRIPTIONS_CANCEL',
	'PREMIUM_PROFILE_CUSTOMIZATION_TRY_IT_OUT',
	'COLLECTIBLES_SHOP',
	'COLLECTIBLES_SHOP_VIEW_ALL_CATEGORY_ITEMS',
	'QUEST_HOME',
	'QUEST_PREVIEW_TOOL',
])

/** Tested against a setting key; keys are the same in every language */
const SETTING_PATTERNS: Array<[OptionKey, RegExp]> = [
	['setFamily', /FAMILY/],
	['setClips', /^CLIPS?$/],
	['setScanQr', /SCAN_?QR/],
	['setSupport', /^(SUPPORT|(UPLOAD_)?DEBUG_LOGS|ACKNOWLEDGE?MENTS)$/],
	['setWhatsNew', /WHATS?_?NEW|CHANGE_?LOG/],
	['setBugReporter', /BUG_?REPORT/],
]

function settingIsHidden(raw: unknown): boolean {
	if (typeof raw !== 'string') return false
	if (isOn('setNitro') && NITRO_SETTING_KEYS.has(raw)) return true
	const text = raw
		.replace(/[\u2018\u2019]/g, '')
		.replace(/'/g, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, '_')
	return SETTING_PATTERNS.some(([option, re]) => isOn(option) && re.test(text))
}

interface SettingsTreeProps {
	node?: {
		sections?: Array<{ label?: unknown; title?: unknown; settings?: string[] }>
	}
}

function pruneTree(props: SettingsTreeProps): SettingsTreeProps {
	const sections = props.node?.sections
	if (!props.node || !Array.isArray(sections)) return props
	if (DEBUG)
		console.log(
			'[junk-cleanup] settings sections',
			sections.map(s => [s.label ?? s.title, s.settings]),
		)

	return {
		...props,
		node: {
			...props.node,
			// A section left without rows goes away together with its header
			sections: sections
				.map(s => ({
					...s,
					settings: s.settings?.filter(k => !settingIsHidden(k)),
				}))
				.filter(s => !s.settings || s.settings.length > 0),
		},
	}
}

function settingsPage(env: Env) {
	for (const list of [
		SettingListRenderer.SettingsList,
		SettingListRenderer.SearchableSettingsList,
	])
		env.cleanup(
			insteadJSX(list as any, ([type, props, key], jsx) =>
				jsx(type, pruneTree(props as SettingsTreeProps), key),
			),
		)

	// Deep links into Nitro and payment screens
	whenPath(
		env,
		'modules/settings/native/renderer/SettingTreeManager.tsx',
		ns => {
			const manager = ns?.default
			if (typeof manager?.isBlocked !== 'function') return
			env.cleanup(
				instead(manager, 'isBlocked', (args: any[], original: any) =>
					isOn('setNitro') && NITRO_SETTING_KEYS.has(args[0])
						? true
						: Reflect.apply(original, manager, args),
				),
			)
		},
	)
}

// ---------------------------------------------------------------------------
// Which sheet is open
// ---------------------------------------------------------------------------

const MESSAGE_SHEET_KEY = /^MessageLongPress/

/** Message menu rows only exist inside the long-press sheet, so track when it is open */
function trackMessageSheet(env: Env) {
	env.cleanup(
		before(ActionSheetActionCreators, 'openLazy', args => {
			ui.messageSheetOpen = MESSAGE_SHEET_KEY.test(String(args[1]))
			return args
		}),
		before(ActionSheetActionCreators, 'hideActionSheet', args => {
			ui.messageSheetOpen = false
			return args
		}),
		before(ActionSheetActionCreators, 'hideAllActionSheets', () => {
			ui.messageSheetOpen = false
			return []
		}),
	)
}

// ---------------------------------------------------------------------------
// Matched by component name or icon, so they work in every language
// ---------------------------------------------------------------------------

/** The name React shows for a component type, memo and forwardRef included */
function nameOfType(type: any): string {
	return (
		type?.displayName ??
		type?.name ??
		type?.type?.displayName ??
		type?.type?.name ??
		type?.render?.displayName ??
		type?.render?.name ??
		''
	)
}

/** Name of the icon component a design-system row was given, e.g. `ClockIcon` */
function iconComponentName(props: any): string | undefined {
	const icon = props?.icon?.props?.IconComponent
	return typeof icon === 'function' ? icon.displayName || icon.name : undefined
}

/** Whole components that exist only to draw one thing */
const COMPONENT_RULES = new Map<string, OptionKey>([
	// The "Add people to Voice Chat" banner on the call screen
	['VoicePanelFloatingCTAContainer', 'voiceAddPeople'],
	// The Xbox and PlayStation rows in the call options
	['GameConsoleAccountButton', 'voiceConsole'],
])

const CONSOLE_BUTTON = 'GameConsoleAccountButton'

/** Components that only count as junk inside the message long-press sheet */
const SHEET_COMPONENT_RULES = new Map<string, OptionKey>([
	// The emoji reaction bar at the top of the menu
	['EmojiRow', 'msgReactions'],
])

function componentRules(env: Env) {
	const holdsConsoleButton = (children: unknown) =>
		React.Children.toArray(children as any).some(
			child =>
				nameOfType((child as { type?: unknown })?.type) === CONSOLE_BUTTON,
		)

	for (const factory of ['jsx', 'jsxs'] as const)
		env.cleanup(
			instead(ReactJSXRuntime as any, factory, (args: any[], original: any) => {
				if (!ui.settingsOpen) {
					const name = nameOfType(args[0])
					const option = COMPONENT_RULES.get(name)
					if (option && isOn(option)) return null
					if (ui.messageSheetOpen && args[1]?.message) {
						const sheetOption = SHEET_COMPONENT_RULES.get(name)
						if (sheetOption && isOn(sheetOption)) return null
					}
					// The "Transfer to Console" header goes together with its rows
					if (
						name === 'TableRowGroup' &&
						isOn('voiceConsole') &&
						holdsConsoleButton(args[1]?.children)
					)
						return null
				}
				return original(...args)
			}),
		)
}

/** Message long-press rows by the icon each one is given */
const MESSAGE_ROW_ICONS = new Map<string, OptionKey>([
	['ForwardingIcon', 'msgForward'],
	['ThreadIcon', 'msgThread'],
	['ChatMarkUnreadIcon', 'msgMarkUnread'],
	['RobotIcon', 'msgApps'],
	['BookmarkOutlineIcon', 'msgBookmark'],
	['BookmarkIcon', 'msgBookmark'],
	['ClockIcon', 'msgReminder'],
	['ChatIcon', 'msgDm'],
	['AtIcon', 'msgMention'],
	['LinkIcon', 'msgCopyLink'],
	['IdIcon', 'msgCopyId'],
	['CopyIcon', 'msgCopyText'],
	['FlagIcon', 'msgReport'],
])

/** True when the row being created was built by Discord's own message sheet */
function builtByMessageSheet(): boolean {
	return (new Error().stack ?? '').includes('LongPressMessageActionSheet')
}

function messageRows(env: Env) {
	for (const row of new Set<unknown>([Design.ActionSheetRow, Design.TableRow]))
		if (row)
			env.cleanup(
				insteadJSX(row as any, (args, jsx) => {
					if (ui.messageSheetOpen && !ui.settingsOpen) {
						const icon = iconComponentName(args[1])
						const option = icon ? MESSAGE_ROW_ICONS.get(icon) : undefined
						// Copy User ID shares this icon but comes from another plugin
						if (
							option &&
							isOn(option) &&
							(icon !== 'CopyIcon' || builtByMessageSheet())
						)
							return null
					}
					return jsx(args[0], args[1], args[2])
				}),
			)
}

// ---------------------------------------------------------------------------
// Attach panel buttons
// ---------------------------------------------------------------------------

/** Each button is a pressable whose first child is the icon that names it */
const ATTACH_ICONS = new Map<string, OptionKey>([
	['ImageIcon', 'attachPhotos'],
	['PollsIcon', 'attachPoll'],
	['ThreadIcon', 'attachThread'],
	['AppsIcon', 'attachApps'],
	['AttachmentIcon', 'attachFiles'],
])

function attachPanel(env: Env) {
	const optionOf = (children: unknown): OptionKey | undefined => {
		for (const child of React.Children.toArray(children as any)) {
			const icon = ATTACH_ICONS.get(
				nameOfType((child as { type?: unknown })?.type),
			)
			if (icon) return icon
		}
	}

	for (const factory of ['jsx', 'jsxs'] as const)
		env.cleanup(
			instead(ReactJSXRuntime as any, factory, (args: any[], original: any) => {
				if (
					!ui.settingsOpen &&
					!ui.messageSheetOpen &&
					nameOfType(args[0]) === 'PressableOpacity'
				) {
					const option = optionOf(args[1]?.children)
					if (option && isOn(option)) return null
				}
				return original(...args)
			}),
		)
}

// ---------------------------------------------------------------------------
// Server header buttons (invite and events, next to the search pill)
// ---------------------------------------------------------------------------

const HEADER_BUTTON_ICONS = new Map<string, OptionKey>([
	['GroupPlusIcon', 'guildInvite'],
	['CalendarIcon', 'guildEvents'],
])

function serverHeader(env: Env) {
	env.cleanup(
		insteadJSX(Design.IconButton, (args, jsx) => {
			const icon = (args[1] as { icon?: unknown } | undefined)?.icon
			if (typeof icon === 'number' && !ui.settingsOpen) {
				const name = assetNameById(icon)
				const option = name ? HEADER_BUTTON_ICONS.get(name) : undefined
				if (option && isOn(option)) return null
			}
			return jsx(args[0], args[1], args[2])
		}),
	)
}

function assetNameById(id: number): string | undefined {
	try {
		return AssetsRegistry.getAssetByID(id)?.name
	} catch {
		return undefined
	}
}

// ---------------------------------------------------------------------------

/** Each surface installs on its own, so one failing never blocks the rest */
export function installPatches(env: Env) {
	for (const install of [
		profileAndChat,
		questsAndShop,
		settingsPage,
		trackMessageSheet,
		messageRows,
		componentRules,
		attachPanel,
		serverHeader,
	])
		safely(env, () => install(env))
}
