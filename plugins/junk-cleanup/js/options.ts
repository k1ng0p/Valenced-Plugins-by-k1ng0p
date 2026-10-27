import type { JsonStorage } from '@valenced/json-storage'

interface OptionDef {
	key: string
	label: string
	hint: string
	/** Turned on for a fresh install */
	preset?: true
}

interface GroupDef {
	title: string
	options: readonly OptionDef[]
}

export const GROUPS = [
	{
		title: 'Profiles and chat',
		options: [
			{
				key: 'avatarDecorations',
				label: 'Avatar decorations',
				hint: 'Decorations around avatars everywhere',
			},
			{
				key: 'nameplates',
				label: 'Nameplates',
				hint: 'Collectible plates behind usernames',
			},
			{
				key: 'profileEffects',
				label: 'Profile effects',
				hint: 'Animated effects on profiles',
			},
			{
				key: 'profileFrames',
				label: 'Profile frames',
				hint: 'Frames around profile avatars',
			},
			{
				key: 'serverTags',
				label: 'Server tags',
				hint: 'Clan tags next to names',
			},
			{
				key: 'badges',
				label: 'Profile badges',
				hint: 'Badge row on user profiles',
			},
			{
				key: 'displayNameStyles',
				label: 'Display name styles',
				hint: 'Fonts, colors and effects on names',
			},
			{
				key: 'wishlist',
				label: 'Wishlist and board tabs',
				hint: 'Extra tabs on user profiles',
			},
			{
				key: 'dmActivityCards',
				label: 'DM activity cards',
				hint: 'Happening-now cards above DMs',
			},
		],
	},
	{
		title: 'Message menu',
		options: [
			{
				key: 'msgReactions',
				label: 'Reaction row',
				hint: 'Emoji reactions at the top of the long-press menu',
			},
			{ key: 'msgForward', label: 'Forward', hint: 'Long-press menu row' },
			{
				key: 'msgThread',
				label: 'Create Thread',
				hint: 'Long-press menu row',
				preset: true,
			},
			{
				key: 'msgMarkUnread',
				label: 'Mark Unread',
				hint: 'Long-press menu row',
				preset: true,
			},
			{
				key: 'msgApps',
				label: 'Apps',
				hint: 'Long-press menu row',
				preset: true,
			},
			{
				key: 'msgBookmark',
				label: 'Bookmark Message',
				hint: 'Long-press menu row',
				preset: true,
			},
			{
				key: 'msgReminder',
				label: 'Create Reminder',
				hint: 'Long-press menu row',
				preset: true,
			},
			{
				key: 'msgDm',
				label: 'Message',
				hint: 'Opens a DM with the author, in the long-press menu',
			},
			{
				key: 'msgMention',
				label: 'Mention',
				hint: 'Mentions the author, in the long-press menu',
			},
			{
				key: 'msgCopyText',
				label: 'Copy Text',
				hint: 'Long-press menu row',
			},
			{
				key: 'msgCopyLink',
				label: 'Copy Message Link',
				hint: 'Long-press menu row',
			},
			{
				key: 'msgCopyId',
				label: 'Copy Message ID',
				hint: 'Long-press menu row',
				preset: true,
			},
			{
				key: 'msgReport',
				label: 'Report',
				hint: 'Long-press menu row',
			},
		],
	},
	{
		title: 'Attachment menu',
		options: [
			{
				key: 'attachPhotos',
				label: 'Photos button',
				hint: 'Bottom bar of the attach panel',
			},
			{
				key: 'attachPoll',
				label: 'Poll button',
				hint: 'Bottom bar of the attach panel',
			},
			{
				key: 'attachThread',
				label: 'Thread button',
				hint: 'Bottom bar of the attach panel',
				preset: true,
			},
			{
				key: 'attachApps',
				label: 'Apps button',
				hint: 'Bottom bar of the attach panel',
				preset: true,
			},
			{
				key: 'attachFiles',
				label: 'Files button',
				hint: 'Bottom bar of the attach panel',
			},
			{
				key: 'attachCamera',
				label: 'Camera shortcut',
				hint: 'Camera tile at the start of the photo grid',
				preset: true,
			},
		],
	},
	{
		title: 'Settings page',
		options: [
			{
				key: 'setFamily',
				label: 'Family Center',
				hint: 'Account settings row',
				preset: true,
			},
			{
				key: 'setClips',
				label: 'Clips',
				hint: 'Account settings row',
				preset: true,
			},
			{
				key: 'setScanQr',
				label: 'Scan QR Code',
				hint: 'Account settings row',
			},
			{
				key: 'setSupport',
				label: 'Support section',
				hint: 'Support, debug logs upload, acknowledgements',
				preset: true,
			},
			{
				key: 'setWhatsNew',
				label: "What's New section",
				hint: 'Changelog section at the bottom',
				preset: true,
			},
			{
				key: 'setBugReporter',
				label: 'Bug Reporter section',
				hint: 'Bug reporter and screenshot report toggle',
				preset: true,
			},
			{
				key: 'setNitro',
				label: 'Nitro and payment rows',
				hint: 'Nitro, Shop, Quests, Boosts, Gifts, Subscriptions',
				preset: true,
			},
		],
	},
	{
		title: 'Server header',
		options: [
			{
				key: 'guildInvite',
				label: 'Invite button',
				hint: 'Add-people button next to the server search',
				preset: true,
			},
			{
				key: 'guildEvents',
				label: 'Events button',
				hint: 'Calendar button next to the server search',
				preset: true,
			},
		],
	},
	{
		title: 'AI features',
		options: [
			{
				key: 'aiConjureRow',
				label: 'Conjure channel row',
				hint: 'Conjure entry in the server channel list',
				preset: true,
			},
			{
				key: 'aiConjureButton',
				label: 'Conjure button',
				hint: 'Wand button in the You bar',
				preset: true,
			},
		],
	},
	{
		title: 'Voice channels and calls',
		options: [
			{
				key: 'voiceAddPeople',
				label: 'Voice chat invite banner',
				hint: 'The add-people banner at the bottom of the call screen',
				preset: true,
			},
			{
				key: 'voiceConsole',
				label: 'Console transfer section',
				hint: 'Xbox and PlayStation transfer in the call options',
				preset: true,
			},
		],
	},
	{
		title: 'Nitro and quests',
		options: [
			{
				key: 'questDock',
				label: 'Quest dock',
				hint: 'Floating quest bar at the bottom',
			},
			{
				key: 'youQuests',
				label: 'Quests button',
				hint: 'You tab floating bar',
			},
			{
				key: 'youShop',
				label: 'Shop button',
				hint: 'You tab floating bar',
				preset: true,
			},
			{
				key: 'youNitro',
				label: 'Nitro button',
				hint: 'You tab floating bar',
				preset: true,
			},
			{
				key: 'youOrbs',
				label: 'Orbs balance',
				hint: 'Balance bar on your profile screen',
			},
			{
				key: 'boostGoal',
				label: 'Boost goal',
				hint: 'Server boost bar in the channel list',
				preset: true,
			},
		],
	},
] as const satisfies readonly GroupDef[]

export type OptionKey = (typeof GROUPS)[number]['options'][number]['key']
export type Settings = Record<OptionKey, boolean>

export const DEFAULTS = Object.fromEntries(
	GROUPS.flatMap(g =>
		g.options.map(o => [o.key, 'preset' in o && o.preset === true]),
	),
) as Settings

let bound: JsonStorage<Settings> | undefined

export function bindStorage(storage: JsonStorage<Settings>) {
	bound = storage
}

/** Read live on every render, so toggling applies without re-patching */
export function isOn(key: OptionKey): boolean {
	return (bound?.cache as Partial<Settings> | undefined)?.[key] ?? DEFAULTS[key]
}

/** Screen state the patches need to know about */
export const ui = {
	/** The plugin's own settings page is showing; it must never hide its own rows */
	settingsOpen: false,
	/** The message long-press sheet is the sheet that was opened last */
	messageSheetOpen: false,
}
