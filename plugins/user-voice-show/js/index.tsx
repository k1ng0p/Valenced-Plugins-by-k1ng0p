import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { insteadJSX } from '@valenced/react/jsx-runtime'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { findInReactFiber } from '@valenced/utils/react'
import { View } from 'react-native'
import patchChat from './chat'
import VoiceIndicator from './indicator'
import patchProfile from './profile'
import SettingsComponent from './settings'
import type {
	Filter,
	FilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import type { FC, MemoExoticComponent, ReactElement } from 'react'
import type { Deps, Icons } from './indicator'

const DEBUG: boolean = false

export interface Settings {
	showInProfile: boolean
	showInDMs: boolean
	showInDMHeader: boolean
	showInMemberList: boolean
	showInChat: boolean
}

export const DefaultSettings: Settings = {
	showInProfile: true,
	showInDMs: true,
	showInDMHeader: true,
	showInMemberList: true,
	showInChat: true,
}

type Child = ReactElement<{ userId?: string; user?: { id: string } }>

type Parent = ReactElement<{ children: Child[] }>

type Make = (userId: string) => ReactElement

type WithMemoComponent = FilterGenerator<
	<P = object>(
		name: string,
	) => Filter<{
		Result: MemoExoticComponent<FC<P>>
		Scopes: [typeof FilterScopes.Initialized]
	}>
>

const withMemoComponent = createFilterGenerator(
	([name], _, exports) =>
		(exports?.type?.displayName ?? exports?.type?.name) === name,
	([name]) => `memoComponent(${name})`,
) as WithMemoComponent

const nameOf = (element: Child) => {
	const type = element?.type as MemoExoticComponent<FC>
	return (
		type?.displayName ??
		(type as unknown as FC)?.name ??
		type?.type?.displayName ??
		type?.type?.name
	)
}

function insertAfter(tree: ReactElement, anchors: string[], make: Make) {
	const parent = findInReactFiber(
		tree,
		(node): node is Parent =>
			Array.isArray(node.props?.children) &&
			node.props.children.some((child: Child) => nameOf(child) === anchors[0]),
	)
	if (!parent) return false

	const { children } = parent.props
	const { props } = children.find(
		child => nameOf(child) === anchors[0],
	) as Child
	const userId = props.userId ?? props.user?.id
	if (!userId) return false

	const index = Math.max(
		...children.map((child, i) => (anchors.includes(nameOf(child)) ? i : -1)),
	)

	parent.props.children = [
		...children.slice(0, index + 1),
		make(userId) as Child,
		...children.slice(index + 1),
	]

	return true
}

interface Patch {
	component: string
	setting: keyof Settings
	place(tree: any, props: any, make: Make): boolean
}

const patches: Patch[] = [
	{
		component: 'MessagesItemChannelContent',
		setting: 'showInDMs',
		place: (tree, _, make) =>
			insertAfter(tree, ['UsernameWithEffects', 'GuildTagChiplet'], make),
	},
	{
		component: 'UserRow',
		setting: 'showInMemberList',
		place(tree, { user }, make) {
			if (!user?.id || !tree?.props?.label) return false

			tree.props.label = (
				<View style={{ flexDirection: 'row', alignItems: 'center' }}>
					{tree.props.label}
					{make(user.id)}
				</View>
			)

			return true
		},
	},
	{
		component: 'PrivateChannelHeader',
		setting: 'showInDMHeader',
		place: (tree, _, make) => insertAfter(tree, ['ChannelTitle'], make),
	},
	{
		component: 'DisplayName',
		setting: 'showInProfile',
		place(tree, { user }, make) {
			const row = tree?.props?.children?.props?.children?.[0]?.props?.children
			if (!user?.id || !Array.isArray(row)) return false

			const indicator = make(user.id)
			if (row.some(child => child?.key === indicator.key)) return true

			row.push(indicator)
			return true
		},
	},
]

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, logger, plugin }) {
		let icons: Icons | undefined
		let transitionToChannel: ((channelId: string) => void) | undefined

		const getIcons = () => {
			if (icons) return icons

			const Speaker =
				lookupGeneratedIconComponent('SpeakerIcon') ??
				lookupGeneratedIconComponent('VoiceNormalIcon')
			if (!Speaker) return

			icons = {
				voice: () => <Speaker size="xs" />,
				mute: lookupGeneratedIconComponent('MicrophoneDenyIcon'),
				deaf: lookupGeneratedIconComponent('HeadphonesDenyIcon'),
				lock: lookupGeneratedIconComponent('VoiceLockIcon'),
			}

			return icons
		}

		const deps: Deps = {
			get icons() {
				return getIcons() as Icons
			},
			open: channelId => transitionToChannel?.(channelId),
		}

		const make: Make = userId => (
			<VoiceIndicator key="voice-indicator" userId={userId} deps={deps} />
		)

		cleanup(
			getModules(
				withProps<{ transitionToChannel(channelId: string): void }>(
					'transitionToChannel',
				),
				module => {
					transitionToChannel = channelId =>
						module.transitionToChannel(channelId)
				},
			),
		)

		const placed = new WeakSet<object>()

		patchChat(
			cleanup,
			e => plugin.reportError(e),
			() => jsonStorage.cache?.showInChat !== false,
			deps.open,
		)

		patchProfile(
			cleanup,
			e => plugin.reportError(e),
			() => jsonStorage.cache?.showInProfile !== false,
			make,
		)

		for (const { component, setting, place } of patches) {
			const render = (tree: ReactElement, props: unknown) => {
				if (jsonStorage.cache?.[setting] === false || placed.has(tree))
					return tree

				try {
					const done = getIcons() && place(tree, props, make)
					if (done) placed.add(tree)
					else if (DEBUG)
						logger.info(
							`[uvs] ${component}: ${icons ? 'no match' : 'no icons'}`,
						)
				} catch (e) {
					plugin.reportError(e)
				}

				return tree
			}

			cleanup(
				getModules(withMemoComponent(component), Component => {
					cleanup(
						instead(Component, 'type', (args, original) =>
							render(original(...args) as ReactElement, args[0]),
						),
					)
				}),
				getModules(withName<FC<object>>(component), Component => {
					const Patched: FC<object> = props =>
						render(Component(props) as ReactElement, props)

					cleanup(
						insteadJSX(Component, ([, props, key], jsx) =>
							jsx(Patched, props, key),
						),
					)
				}),
				getModules(withProps<Record<string, FC<object>>>(component), mod => {
					if (typeof mod[component] !== 'function') return

					cleanup(
						instead(mod, component, (args, original) =>
							render(original(...args) as ReactElement, args[0]),
						),
					)
				}),
			)
		}
	},
	SettingsComponent,
})
