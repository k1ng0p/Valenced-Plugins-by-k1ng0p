import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { after } from '@valenced/patcher'
import { cloneElement } from 'react'
import { defaults } from './settings'
import type { JsonStorage } from '@valenced/json-storage'
import type { PluginCleanupApi } from '@valenced/plugins/types'
import type { ReactElement, ReactNode } from 'react'
import type { Settings } from './settings'

export type Render = (...args: unknown[]) => unknown

type Row = ReactElement<{
	children?: ReactNode
	accessibilityActions?: { name?: unknown }[]
	trailing?: ReactElement<{ children?: ReactNode }>
}>

export function nameOf(type: unknown): string {
	if (typeof type === 'string') return type
	const target = type as {
		displayName?: string
		name?: string
		type?: unknown
	} | null
	return (
		target?.displayName ??
		target?.name ??
		(target?.type ? nameOf(target.type) : typeof type)
	)
}

// isValidElement rejects some of the elements Discord builds
export function isElement(node: unknown): node is Row {
	const element = node as { $$typeof?: unknown; props?: unknown } | null
	return (
		typeof element === 'object' &&
		element !== null &&
		element.$$typeof !== undefined &&
		typeof element.props === 'object'
	)
}

function removeRowAction(node: ReactNode, action: string): ReactNode {
	if (Array.isArray(node))
		return node.map(child => removeRowAction(child, action))
	if (!isElement(node)) return node

	const { accessibilityActions: actions, trailing, children } = node.props
	const buttons = isElement(trailing) ? trailing.props.children : undefined
	const buttonList = buttons == null ? [] : [buttons].flat()
	const index =
		actions?.findIndex(a => String(a.name).toLowerCase() === action) ?? -1

	if (
		actions &&
		trailing &&
		index >= 0 &&
		buttonList.length === actions.length
	) {
		return cloneElement(node, {
			accessibilityActions: actions.filter((_, i) => i !== index),
			trailing: cloneElement(
				trailing,
				{ children: null },
				...buttonList.filter((_, i) => i !== index),
			),
		})
	}

	if (children == null) return node
	const cleaned = removeRowAction(children, action)
	return Array.isArray(cleaned)
		? cloneElement(node, undefined, ...cleaned)
		: cloneElement(node, undefined, cleaned)
}

export function patchUserRow(
	cleanup: PluginCleanupApi,
	jsonStorage: JsonStorage<Settings>,
	reportError: (error: unknown) => void,
) {
	cleanup(
		getModuleWithImportedPath<{ default: unknown }>(
			'modules/main_tabs_v2/native/shared_components/user_list/UserRow.tsx',
			module => {
				const component = module.default as
					| Render
					| { type?: unknown }
					| undefined
				const isPlain = typeof component === 'function'
				const host = (isPlain ? module : component) as
					| Record<string, Render>
					| undefined
				const key = isPlain ? 'default' : 'type'

				if (typeof host?.[key] !== 'function') {
					reportError(new Error('Friend row render function not found'))
					return
				}

				cleanup(
					after(host, key, rendered => {
						const { hideCallButton, hideChatButton } = {
							...defaults,
							...jsonStorage.cache,
						}
						try {
							let tree = rendered as ReactNode
							if (hideCallButton) tree = removeRowAction(tree, 'call')
							if (hideChatButton) tree = removeRowAction(tree, 'message')
							return tree
						} catch (error) {
							reportError(error)
							return rendered
						}
					}),
				)
			},
		),
	)
}
