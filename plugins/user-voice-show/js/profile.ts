import { getModules } from '@valenced/modules/finders'
import { createFilterGenerator } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { findInTree } from '@valenced/utils/tree'
import type {
	Filter,
	FilterGenerator,
	FilterScopes,
} from '@valenced/modules/finders/filters'
import type { ReactElement } from 'react'

type WithExactName = FilterGenerator<
	(name: string) => Filter<{
		Result: any
		Scopes: [typeof FilterScopes.Initialized]
	}>
>

const moduleName = (mod: any): string | undefined =>
	mod?.name ||
	mod?.default?.name ||
	mod?.type?.name ||
	mod?.default?.type?.name ||
	mod?.render?.name ||
	mod?.default?.render?.name

const withExactName = createFilterGenerator(
	([name]: [string], _, exports) => moduleName(exports) === name,
	([name]) => `withExactName(${name})`,
) as WithExactName

const elementName = (node: any): string | undefined =>
	node?.type?.displayName ??
	node?.type?.name ??
	node?.type?.type?.name ??
	node?.type?.render?.name

const findNode = (tree: any, filter: (node: any) => unknown): any =>
	findInTree(tree, filter as (node: any) => boolean, {
		walkable: new Set(['props', 'children']),
	})

function patchTarget(mod: any) {
	if (typeof mod?.default === 'function') return { parent: mod, key: 'default' }
	if (typeof mod?.default?.type === 'function')
		return { parent: mod.default, key: 'type' }
	if (typeof mod?.default?.render === 'function')
		return { parent: mod.default, key: 'render' }
	if (typeof mod?.type === 'function') return { parent: mod, key: 'type' }
	if (typeof mod?.render === 'function') return { parent: mod, key: 'render' }
}

export default function patchProfile(
	cleanup: (...cleanups: (() => unknown)[]) => void,
	reportError: (error: unknown) => void,
	enabled: () => boolean,
	make: (userId: string) => ReactElement,
) {
	const safely = (fn: () => void) => {
		try {
			fn()
		} catch (e) {
			reportError(e)
		}
	}

	const patchName = (tree: any) => {
		const name = findNode(tree, node => node?.type?.name === 'DisplayName')
		if (!name) return false

		cleanup(
			after(name, 'type', (displayName: any) => {
				safely(() => {
					const userId = name.props?.user?.id
					const children = displayName?.props?.children
					if (!userId || !enabled() || !Array.isArray(children)) return

					const indicator = make(userId)
					if (!children.some(child => child?.key === indicator.key))
						children.push(indicator)
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
				after(target.parent, target.key, (content: any) => {
					safely(() => {
						const primary = findNode(
							content,
							node => node?.type?.name === 'PrimaryInfo',
						)
						if (!primary) return

						cleanup(
							after(primary, 'type', (info: any) => {
								safely(() => {
									if (patchName(info)) return

									const primaryInfo = findNode(
										info,
										node => elementName(node) === 'UserProfilePrimaryInfo',
									)
									const component =
										typeof primaryInfo?.type === 'function'
											? primaryInfo
											: typeof primaryInfo?.type?.type === 'function'
												? primaryInfo.type
												: undefined
									if (!component) return

									cleanup(
										after(component, 'type', (rendered: any) => {
											safely(() => patchName(rendered))
											return rendered
										}),
									)
								})

								return info
							}),
						)
					})

					return content
				}),
			)
		}),
	)
}
