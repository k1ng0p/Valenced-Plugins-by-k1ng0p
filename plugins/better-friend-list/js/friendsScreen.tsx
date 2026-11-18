import { getModules } from '@valenced/modules/finders'
import { createFilterGenerator } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { cloneElement } from 'react'
import { isElement, nameOf } from './patches'
import { defaults } from './settings'
import type { JsonStorage } from '@valenced/json-storage'
import type { PluginCleanupApi } from '@valenced/plugins/types'
import type { ReactElement, ReactNode } from 'react'
import type { Render } from './patches'
import type { Settings } from './settings'

type UserList = ReactElement<{ actions?: unknown[] }>

// Valenced caches matches per key, so a changed filter needs a new key
const withDefaultName = createFilterGenerator(
	([name]: [string], _id, exports) => {
		try {
			return nameOf((exports as { default?: unknown }).default) === name
		} catch {
			return false
		}
	},
	([name]) => `better-friend-list-default-${name}`,
)

const withRequestCounts = createFilterGenerator(
	(_args: [], _id, exports) => {
		try {
			return Object.keys(exports as object).includes(
				'getIncomingFriendRequestCount',
			)
		} catch {
			return false
		}
	},
	() => 'better-friend-list-request-counts',
)

function editUserList(
	node: ReactNode,
	edit: (list: UserList) => ReactNode,
): ReactNode {
	if (Array.isArray(node))
		return node.flatMap(child => editUserList(child, edit))
	if (!isElement(node)) return node
	if (nameOf(node.type) === 'SearchableUserList') return edit(node as UserList)
	const { children } = node.props
	if (children == null) return node
	const edited = editUserList(children, edit)
	return Array.isArray(edited)
		? cloneElement(node, undefined, ...edited)
		: cloneElement(node, undefined, edited)
}

export function patchFriendsScreen(
	cleanup: PluginCleanupApi,
	jsonStorage: JsonStorage<Settings>,
	reportError: (error: unknown) => void,
) {
	let incoming: unknown
	let outgoing: unknown

	// The counters need arguments only Discord's own callers know, so read their results
	cleanup(
		getModules(withRequestCounts(), exports => {
			const counters = exports as Record<string, Render>
			cleanup(
				after(counters, 'getIncomingFriendRequestCount', result => {
					incoming = result
					return result
				}),
			)
			cleanup(
				after(counters, 'getOutgoingFriendRequestCount', result => {
					outgoing = result
					return result
				}),
			)
		}),
	)

	cleanup(
		getModules(withDefaultName('FriendsScreen'), exports => {
			const module = exports as { default: Render | { type?: Render } }
			const isPlain = typeof module.default === 'function'
			const host = (isPlain ? module : module.default) as Record<string, Render>
			const key = isPlain ? 'default' : 'type'

			cleanup(
				after(host, key, rendered => {
					const { hideEmptyRequests } = { ...defaults, ...jsonStorage.cache }
					if (!hideEmptyRequests || incoming !== 0 || outgoing !== 0)
						return rendered
					try {
						return editUserList(rendered as ReactNode, list =>
							cloneElement(list, { actions: [] }),
						)
					} catch (error) {
						reportError(error)
						return rendered
					}
				}),
			)
		}),
	)
}
