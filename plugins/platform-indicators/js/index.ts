import { getModules } from '@valenced/modules/finders'
import {
	createFilterGenerator,
	FilterScopes,
	withProps,
} from '@valenced/modules/finders/filters'
import { after, instead } from '@valenced/patcher'
import { findInTree } from '@valenced/utils/tree'
import { createElement } from 'react'
import { View } from 'react-native'
import { StatusDot, StatusIcons, StatusIconsRow } from './components'
import {
	dotAllowedForContext,
	findAsset,
	getStatuses,
	inlineIconsAllowed,
	pickDotPlatform,
	resolveContext,
} from './platforms'
import { stopPresence } from './presence'
import SettingsComponent from './settings'
import { bindApi, DefaultSettings, getSettings, reportError } from './shared'
import type { Filter, FilterGenerator } from '@valenced/modules/finders/filters'
import type { Settings } from './shared'

const UserRowKey = 'TabsV2MemberListStatusIconsView'
const DmListKey = 'TabsV2RedesignDMListIcons'

const Walk = { walkable: new Set(['props', 'children']) }

const findNode = (tree: any, filter: (node: any) => unknown): any =>
	findInTree(tree, filter as (node: any) => boolean, Walk)

interface PatchTarget {
	parent: any
	key: string
}

type WithExactName = FilterGenerator<
	(name: string) => Filter<{
		Result: any
		Scopes: [typeof FilterScopes.Initialized]
	}>
>

type WithStatusAvatarBundle = FilterGenerator<
	() => Filter<{
		Result: any
		Scopes: [typeof FilterScopes.Initialized, typeof FilterScopes.Uninitialized]
	}>
>

const getName = (mod: any): string | undefined =>
	mod?.name ||
	mod?.default?.name ||
	mod?.type?.name ||
	mod?.default?.type?.name ||
	mod?.render?.name ||
	mod?.default?.render?.name

const withExactName = createFilterGenerator(
	([name]: [string], _id, exports) => getName(exports) === name,
	([name]) => `withExactName(${name})`,
) as WithExactName

const withStatusAvatarBundle = createFilterGenerator(
	(_args: [], _id, exports: any) =>
		!!exports &&
		typeof exports.Status === 'function' &&
		typeof exports.Avatar !== 'undefined' &&
		typeof exports.BADGE_SIZE === 'number',
	() => 'withStatusAvatarBundle',
	FilterScopes.Initialized | FilterScopes.Uninitialized,
) as WithStatusAvatarBundle

function patchTarget(mod: any): PatchTarget | undefined {
	if (typeof mod?.default === 'function') return { parent: mod, key: 'default' }
	if (typeof mod?.default?.type === 'function')
		return { parent: mod.default, key: 'type' }
	if (typeof mod?.default?.render === 'function')
		return { parent: mod.default, key: 'render' }
	if (typeof mod?.type === 'function') return { parent: mod, key: 'type' }
	if (typeof mod?.render === 'function') return { parent: mod, key: 'render' }
}

function safely(fn: () => void) {
	try {
		fn()
	} catch (e) {
		reportError(e)
	}
}

const nodeName = (node: any): string | undefined =>
	node?.type?.displayName ??
	node?.type?.name ??
	node?.type?.type?.name ??
	node?.type?.render?.name

const hasUser = (node: any) => node?.props?.user?.id !== undefined

const isStatusElement = (node: any) =>
	(node?.type?.name ?? node?.type?.displayName) === 'Status' ||
	(node?.props &&
		typeof node.props.status === 'string' &&
		typeof node.props.streaming === 'boolean')

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DefaultSettings,
	},
	start({ cleanup, jsonStorage, plugin }) {
		bindApi(jsonStorage, plugin)
		cleanup(() => bindApi(undefined, undefined))
		cleanup(stopPresence)

		if (plugin.startedLate) plugin.requireReload()

		cleanup(
			getModules(withExactName('ChannelHeader'), mod => {
				const target = patchTarget(mod)
				if (!target) return

				cleanup(
					after(target.parent, target.key, (result: any) => {
						safely(() => {
							if (result?.type?.type?.name !== 'PrivateChannelHeader') return

							cleanup(
								after(result.type, 'type', (header: any) => {
									safely(() => {
										const userId = findNode(header, hasUser)?.props?.user?.id
										if (!userId || !inlineIconsAllowed('dmTopBar')) return

										const container = findNode(
											header,
											node => node?.key === 'DMTabsV2HeaderIcons',
										)
										if (container) {
											container.props.children = createElement(StatusIcons, {
												userId,
											})
											return
										}

										const inner =
											header.props?.children?.props?.children?.props
												?.children?.[1]
										if (inner && typeof inner.type === 'function') {
											const unpatch = after(inner, 'type', (rendered: any) => {
												unpatch()
												safely(() => {
													const present = findNode(
														rendered,
														node => node?.key === 'DMTabsV2Header-v2',
													)
													if (!present)
														rendered.props.children[0]?.props?.children?.push(
															createElement(StatusIcons, {
																key: 'DMTabsV2Header-v2',
																userId,
															}),
														)
												})
												return rendered
											})
											cleanup(unpatch)
										}
									})
									return header
								}),
							)
						})
						return result
					}),
				)
			}),
		)

		const patchProfileName = (tree: any) => {
			const name = findNode(tree, node => node?.type?.name === 'DisplayName')
			if (!name) return false

			cleanup(
				after(name, 'type', (displayName: any) => {
					safely(() => {
						const userId = name.props?.user?.id
						if (userId && inlineIconsAllowed('profileUsername'))
							displayName?.props?.children?.push(
								createElement(StatusIcons, { key: 'UserProfileIcons', userId }),
							)
					})
					return displayName
				}),
			)
			return true
		}

		cleanup(
			getModules(withExactName('UserProfileContent'), mod => {
				const target = patchTarget(mod)
				if (!target) return

				cleanup(
					after(target.parent, target.key, (result: any) => {
						safely(() => {
							const primary = findNode(
								result,
								node => node?.type?.name === 'PrimaryInfo',
							)
							if (!primary) return

							cleanup(
								after(primary, 'type', (info: any) => {
									safely(() => {
										if (patchProfileName(info)) return

										const primaryInfo = findNode(
											info,
											node => nodeName(node) === 'UserProfilePrimaryInfo',
										)
										const holder =
											typeof primaryInfo?.type === 'function'
												? primaryInfo
												: typeof primaryInfo?.type?.type === 'function'
													? primaryInfo.type
													: undefined
										if (!holder) return

										cleanup(
											after(holder, 'type', (content: any) => {
												safely(() => patchProfileName(content))
												return content
											}),
										)
									})
									return info
								}),
							)
						})
						return result
					}),
				)
			}),
		)

		cleanup(
			getModules(
				withProps<{ DisplayName: (props: any) => any }>('DisplayName'),
				mod => {
					cleanup(
						instead(mod, 'DisplayName', (args, original) => {
							const result = original(...args)
							safely(() => {
								const user = args[0]?.user
								const children =
									result.props?.children?.props?.children?.[0]?.props?.children
								if (
									!user?.id ||
									!Array.isArray(children) ||
									!inlineIconsAllowed('profileUsername')
								)
									return
								if (children.some(child => child?.key === 'DisplayNameIcons'))
									return

								children.push(
									createElement(StatusIcons, {
										key: 'DisplayNameIcons',
										userId: user.id,
									}),
								)
							})
							return result
						}),
					)
				},
			),
		)

		cleanup(
			getModules(withExactName('UserRow'), mod => {
				const target = patchTarget(mod)
				if (!target) return

				cleanup(
					instead(target.parent, target.key, (args: any[], original: any) => {
						const [props] = args
						const result = original(...args)
						safely(() => {
							const user = props?.user
							if (!user?.id || !inlineIconsAllowed('userList')) return

							const wrapped = findNode(
								result?.props?.label,
								node => node?.key === UserRowKey,
							)
							if (wrapped) return

							result.props.label = createElement(
								View,
								{
									key: UserRowKey,
									style: {
										justifyContent: 'flex-start',
										flexDirection: 'row',
										alignItems: 'center',
									},
								},
								result.props.label,
								createElement(StatusIconsRow, {
									key: UserRowKey,
									userId: user.id,
								}),
							)
						})
						return result
					}),
				)
			}),
		)

		cleanup(
			getModules(withExactName('MessagesItemChannelContent'), mod => {
				const target = patchTarget(mod)
				if (!target) return

				cleanup(
					instead(target.parent, target.key, (args: any[], original: any) => {
						const [props] = args
						const result = original(...args)
						safely(() => {
							if (
								props?.channel?.recipients?.length !== 1 ||
								!inlineIconsAllowed('userList')
							)
								return

							const titleNode = findNode(result, node =>
								node?.props?.children?.[0]?.props?.variant?.includes?.(
									'channel-title',
								),
							)
							if (!titleNode) return

							const present = findNode(
								titleNode,
								node => node?.key === DmListKey,
							)
							if (!present)
								titleNode.props?.children?.push(
									createElement(StatusIconsRow, {
										key: DmListKey,
										userId: props.channel.recipients[0],
									}),
								)
						})
						return result
					}),
				)
			}),
		)

		cleanup(
			getModules(withStatusAvatarBundle(), mod => {
				const target: PatchTarget | undefined =
					typeof mod.Avatar?.type === 'function'
						? { parent: mod.Avatar, key: 'type' }
						: typeof mod.Avatar === 'function'
							? { parent: mod, key: 'Avatar' }
							: undefined
				if (!target) return

				cleanup(
					instead(target.parent, target.key, (args: any[], original: any) => {
						const [props] = args
						const result = original(...args)
						if (!getSettings().experimentalStatusDot) return result

						try {
							const kids = result?.props?.children
							if (!Array.isArray(kids)) return result

							const index = kids.findIndex(isStatusElement)
							if (index === -1) return result

							const userId =
								props?.user?.id ??
								kids.find(kid => kid?.props?.user?.id)?.props?.user?.id
							if (!userId) return result

							const statusElement = kids[index]
							const statuses = getStatuses(userId) ?? {}
							const platform = pickDotPlatform(statuses)
							const hasIcon =
								dotAllowedForContext(resolveContext(props?.size)) &&
								!!platform &&
								!!findAsset(platform, true)
							const children = kids.map((kid, i) => {
								if (i === index)
									return createElement(StatusDot, {
										key: statusElement.key ?? 'StatusDot',
										userId,
										original: statusElement,
										size: props?.size,
									})
								if (hasIcon && kid?.props?.cutout != null)
									return { ...kid, props: { ...kid.props, cutout: undefined } }
								return kid
							})
							return { ...result, props: { ...result.props, children } }
						} catch (e) {
							reportError(e)
							return result
						}
					}),
				)
			}),
		)
	},
	stop() {
		this.requireReload()
	},
	SettingsComponent,
})
