import { RootNavigationRef } from '@valenced/discord/modules/main_tabs_v2'
import { formatVersion } from '@valenced/plugins/utils'
import { BUILT_IN_REPO, askReload, asObject, clearProblems, confirm, errorMessage, fail, logProblem, native, reportError, showError, slash, tap, usesEnvelope } from './shared'
import type { AvailableUpdate, ListedPlugin, PluginRef, Repo, ValencedRepo } from './shared'
export type PendingUpdate = { id: string; name: string; installed: string; available: string; channel: string }
export type ValencedState = Awaited<ReturnType<typeof readState>>

export const available = new Map<string, AvailableUpdate>()
export const blocked = new Map<string, { repo: string; text: string }>()
export const pendingReload = new Set<string>()
// ids offered by the repositories added to Valenced, a dependency from any of them can be installed
export const providedIds = new Set<string>()

let repoWrites: Promise<unknown> = Promise.resolve()

const repoList = (): Promise<ValencedRepo[]> => native('valenced.plugins.repos.list')

const warningMessages = (plan: any): string[] =>
	(plan?.warnings ?? [])
		.filter((warning: any) => warning?.type !== 'upToDate')
		.map((warning: any) => (typeof warning === 'string' ? warning : warning?.message))
		.filter(Boolean)

async function refreshProvided(repos: ValencedRepo[]) {
	const found = new Set<string>()
	await Promise.all(
		repos
			.filter(repo => repo.enabled)
			.map(repo =>
				native('valenced.plugins.repos.listPlugins', [repo.url]).then(
					(list: { id: string }[] | null) => {
						for (const item of list ?? []) found.add(item.id)
					},
					error => logProblem(`list ${repo.url}`, error),
				),
			),
	)
	providedIds.clear()
	for (const id of found) providedIds.add(id)
}

export async function readState() {
	const envelope = await usesEnvelope()
	const [repos, plugins, saved, slots] = await Promise.all([
		repoList(),
		native('valenced.plugins.list'),
		native('valenced.plugins.states.read'),
		envelope ? native('valenced.plugins.states.getSlots').catch(() => null) : null,
	])

	await refreshProvided(repos ?? [])

	const installed = new Map<string, { version: string; settings: boolean; source: { repo: string | null; channel: string; held: boolean } | null }>()
	let discord: string | undefined
	for (const plugin of plugins ?? []) {
		if (plugin.manifest.id === 'discord') discord = formatVersion(plugin.manifest.version)
		if (plugin.internal) continue
		installed.set(plugin.manifest.id, {
			version: formatVersion(plugin.manifest.version),
			settings: !!plugin.script?.includes('SettingsComponent'),
			source: plugin.source ?? null,
		})
	}

	const enabled: Record<string, { enabled?: boolean; pendingReload?: boolean }> = envelope ? (asObject(saved)[slots?.active] ?? {}) : (saved?.states ?? {})
	return { repos: repos ?? [], installed, enabled, discord }
}

export async function refreshAvailable(catalog: Repo[]) {
	const added = await repoList().catch(error => {
		reportError(error, 'read the added repositories')
		return []
	})
	const envelope = await usesEnvelope()
	const found: AvailableUpdate[] = []
	const blockedNow = new Map<string, { repo: string; text: string }>()
	const checked = new Set<string>()

	const active = catalog.filter(repo => added.some(item => !item.internal && item.enabled && slash(item.url) === slash(repo.url)))
	// valenced plans updates from its own cached index, so refresh that first
	for (let start = 0; start < active.length; start += REFRESH_BATCH) {
		await Promise.all(
			active.slice(start, start + REFRESH_BATCH).map(repo =>
				native('valenced.plugins.repos.refresh', [repo.url]).then(
					() => clearProblems(`refresh ${repo.url}`),
					error => logProblem(`refresh ${repo.url}`, error),
				),
			),
		)
	}

	if (envelope) {
		try {
			const updates: any[] = (await native('valenced.plugins.listUpdates')) ?? []
			const names = new Map<string, string>(((await native('valenced.plugins.list')) ?? []).map((plugin: any) => [plugin.manifest.id, plugin.manifest.name]))
			for (const repo of active) {
				checked.add(repo.url)
				for (const update of updates) {
					if (slash(update.repo ?? '') !== slash(repo.url)) continue
					if (update.blocker) blockedNow.set(update.id, { repo: repo.url, text: describeIssue(update.blocker, names) })
					else found.push({ ...update, repo: repo.url })
				}
			}
		} catch {
			// not indexed yet
		}
	} else {
		await Promise.all(
			active.map(async repo => {
				try {
					for (const update of (await native('valenced.plugins.repos.listUpdates', [repo.url])) ?? []) found.push({ ...update, repo: repo.url })
					checked.add(repo.url)
				} catch {
					// not indexed yet
				}
			}),
		)
	}

	for (const [id, info] of available) if (checked.has(info.repo) || !catalog.some(repo => repo.url === info.repo)) available.delete(id)
	for (const [id, info] of blocked) if (checked.has(info.repo) || !catalog.some(repo => repo.url === info.repo)) blocked.delete(id)
	for (const [id, info] of blockedNow) blocked.set(id, info)
	for (const info of found) available.set(info.id, info)

	return checked
}

function describeIssue(issue: any, names: Map<string, string>): string {
	const nameOf = (id: string) => names.get(id) ?? id
	switch (issue.type) {
		case 'breaks':
			return `Breaks ${nameOf(issue.dependent)}, which needs ${nameOf(issue.id)} ${issue.range}.${issue.fixedBy ? ' Select its update to fix this.' : ''}`
		case 'conflict':
			return `${nameOf(issue.dependent)} v${issue.dependentVersion} needs ${nameOf(issue.id)} ${issue.range}, but gets v${issue.version}.`
		case 'unresolved': {
			const name = nameOf(issue.id)
			let problem = `No version of ${name} matching ${issue.range} is available`
			if (issue.reason === 'held') problem = `${name} is paused at v${issue.installed}, but ${issue.range} is needed. Resume its updates first.`
			else if (issue.reason === 'target') problem = `${issue.detail}`
			return issue.optional ? `Skips optional ${name}. ${problem}` : problem
		}
		case 'unavailable':
			return issue.version ? `Version ${issue.version} is not available` : 'Not available from its repository'
		case 'held':
			return `Updates are paused at v${issue.version}. Turn on "Allow updates" to update.`
		case 'downgrade':
			return `Downgrades from v${issue.from} to v${issue.to}`
		default:
			return 'Already up to date'
	}
}

async function writeRepos(url: string, enabled: boolean) {
	const list = (await repoList()).filter(repo => !repo.internal).map(repo => ({ url: repo.url, enabled: slash(repo.url) === slash(url) ? enabled : repo.enabled }))
	if (!list.some(repo => slash(repo.url) === slash(url))) list.push({ url, enabled })
	await native('valenced.plugins.repos.set', [list])
	await native('valenced.plugins.repos.refresh', [url]).catch(() => {})
}

export function putRepos(url: string, enabled: boolean) {
	const job = repoWrites.then(() => writeRepos(url, enabled))
	repoWrites = job.catch(() => {})
	return job
}

// refreshing every repository at once floods the network and the native side
const REFRESH_BATCH = 4

// theme and icon packs are picked in the Themes settings, which needs both of these running
export const THEME_SUPPORT = [
	{ id: 'valenced.api.themes', name: 'Themes API' },
	{ id: 'valenced.settings.themes', name: 'Themes' },
]
export const THEMES_SETTINGS = 'valenced.settings.themes'

export const setHeld = (id: string, held: boolean) =>
	native('valenced.plugins.setHeld', [id, held]).then(result => {
		tap()
		return result
	})

// the plugin comes from the chosen repository, what it depends on from any repository added to Valenced
const planTarget = (id: string, repo: string, target?: { version: string } | { channel: string }) => ({ targets: { [id]: { repo, ...target } } })

// asks Valenced whether a plugin can be installed, so the reason shows before anyone taps Install
export async function checkInstall(repoUrl: string, plugin: ListedPlugin, ref?: PluginRef) {
	try {
		const known = (await repoList()).find(repo => slash(repo.url) === slash(repoUrl))
		if (!known?.enabled) return null
		const envelope = await usesEnvelope()
		const target = ref?.type === 'version' ? { version: ref.version } : ref ? { channel: ref.channel } : undefined
		await native('valenced.plugins.planInstall', envelope ? [plugin.id, planTarget(plugin.id, known.url, target)] : [plugin.id, null, null, [known.url]])
		return null
	} catch (e) {
		return errorMessage(e).split('\n')[0]
	}
}

export function openPluginSettings(id: string) {
	const nav = RootNavigationRef.getRootNavigationRef()
	if (nav.isReady()) (nav as any).navigate(id)
}

export async function uninstall(plugin: ListedPlugin, dependents: string[] = []) {
	const warning = dependents.length ? `\n\nRequired by: ${dependents.join(', ')}. Removing it may break them.` : ''
	if (!(await confirm('Uninstall plugin?', `${plugin.name} and all of its data will be removed. This cannot be undone.${warning}`, 'Uninstall', 'destructive'))) return false
	try {
		await native('valenced.plugins.setEnabled', [plugin.id, false, false]).catch(() => {})
		await native('valenced.plugins.uninstall', [plugin.id])
		tap()
		askReload('Uninstalled. Reload to apply it.')
		return true
	} catch (e) {
		fail(e, `uninstall ${plugin.name}`, [`${plugin.name} (${plugin.id})`])
		return false
	}
}

export async function install(repoUrl: string, plugin: ListedPlugin, ref?: PluginRef) {
	try {
		let known = (await repoList()).find(repo => slash(repo.url) === slash(repoUrl))
		// the built in repository can't be added by hand, so installing from it adds it
		if (!known?.enabled && slash(repoUrl) === BUILT_IN_REPO.url) {
			await putRepos(repoUrl, true)
			known = (await repoList()).find(repo => slash(repo.url) === slash(repoUrl))
		}
		if (!known?.enabled) {
			showError(new Error('Add this repository to Valenced first'))
			return false
		}

		const envelope = await usesEnvelope()
		const target = ref?.type === 'version' ? { version: ref.version } : ref ? { channel: ref.channel } : undefined
		const plan = await native('valenced.plugins.planInstall', envelope ? [plugin.id, planTarget(plugin.id, known.url, target)] : [plugin.id, null, null, [known.url]])
		const others = plan.actions.filter((action: any) => action.id !== plugin.id).map((action: any) => `${action.id} ${action.version}`)
		const warnings = warningMessages(plan)

		const lines = [`${plugin.name} ${plan.actions.find((action: any) => action.id === plugin.id)?.version ?? ''}`]
		if (others.length) lines.push(`Also installs: ${others.join(', ')}`)
		if (warnings.length) lines.push(warnings.join('\n'))
		if (ref?.type === 'version') lines.push('Updates will be paused to stay on this version. Pick a channel or turn on Allow updates to receive updates again.')
		if (!(await confirm('Install plugin?', lines.join('\n\n')))) return false

		const result = await native('valenced.plugins.install', [plan])
		tap()
		if (result?.pending?.length) askReload('Installed. Reload to apply it.')
		return true
	} catch (e) {
		fail(e, `install ${plugin.name}`, [`${plugin.name} (${plugin.id}${plugin.version ? `@${plugin.version}` : ''})`, `Repository: ${repoUrl}`])
		return false
	}
}

export async function updatePlugins(updates: PendingUpdate[]) {
	const done: PendingUpdate[] = []
	try {
		const envelope = await usesEnvelope()
		const plans: any[] = []
		for (const item of updates) {
			plans.push(await native('valenced.plugins.planInstall', envelope ? [item.id, { skipMissingOptionals: true }] : [item.id, null, item.channel, null]))
		}

		const lines = updates.map(item => `${item.name} ${item.installed} to ${item.available}`)
		const warnings = plans.flatMap(warningMessages)
		if (warnings.length) lines.push(warnings.join('\n'))
		const title = updates.length === 1 ? 'Update plugin?' : `Update ${updates.length} plugins?`
		if (!(await confirm(title, lines.join('\n'), 'Update'))) return false

		for (const [index, plan] of plans.entries()) {
			await native('valenced.plugins.install', [plan])
			pendingReload.add(updates[index].id)
			done.push(updates[index])
		}
		tap()
		askReload('Updated. Reload to apply it.')
		return true
	} catch (e) {
		reportError(e, 'update plugins')
		if (done.length) askReload(`Updated ${done.length} of ${updates.length}. ${errorMessage(e)}\nReload to apply the ones that worked.`)
		else showError(e)
		return false
	}
}

async function writeEnabled(id: string, on: boolean) {
	const res = await native('valenced.plugins.setEnabled', [id, on, on])
	if (res?.code) {
		const message = res.problems?.map((problem: any) => `${problem.id} (${problem.required})`).join(', ') ?? res.code
		throw Object.assign(new Error(message), { code: res.code, details: { problems: res.problems } })
	}
}

async function setEnabled(id: string, on: boolean) {
	try {
		await writeEnabled(id, on)
	} catch (e: any) {
		const disabled = on ? (e?.details?.problems ?? []).filter((problem: any) => problem.installed && !problem.enabled) : []
		if (!disabled.length) throw e
		for (const dependency of disabled) await native('valenced.plugins.setEnabled', [dependency.id, true, false])
		await writeEnabled(id, on)
	}
}

export async function toggle(id: string, on: boolean) {
	try {
		await setEnabled(id, on)
		tap()
		askReload(`${on ? 'Enabled' : 'Disabled'}. Reload to apply it.`)
		return true
	} catch (e) {
		fail(e, `${on ? 'enable' : 'disable'} ${id}`)
		return false
	}
}

export type BulkItem = { id: string; name: string; repo: string; repoName: string; version?: string; size?: number; description?: string; icon?: string }

export async function installMany(items: BulkItem[]) {
	const done: string[] = []
	try {
		const enabledRepos = (await repoList()).filter(repo => repo.enabled).map(repo => slash(repo.url))
		for (const url of [...new Set(items.map(item => slash(item.repo)))].filter(url => !enabledRepos.includes(url))) await putRepos(url, true)
		const repos = await repoList()
		const urlOf = (url: string) => repos.find(repo => slash(repo.url) === slash(url))?.url ?? url

		const envelope = await usesEnvelope()
		const planned: BulkItem[] = []
		const plans: any[] = []
		const skipped: string[] = []
		for (const item of items) {
			const repo = urlOf(item.repo)
			try {
				plans.push(await native('valenced.plugins.planInstall', envelope ? [item.id, planTarget(item.id, repo)] : [item.id, null, null, [repo]]))
				planned.push(item)
			} catch (e) {
				skipped.push(`${item.name}: ${errorMessage(e).split('\n')[0]}`)
			}
		}
		if (!plans.length) return showError(new Error(skipped.join('\n')))

		const extras = [...new Set(plans.flatMap(plan => plan.actions.map((action: any) => action.id as string)))].filter(id => !planned.some(item => item.id === id))
		const warnings = plans.flatMap(warningMessages)
		if (extras.length || warnings.length || skipped.length) {
			const more: string[] = []
			if (skipped.length) more.push(`Skipped:\n${skipped.join('\n')}`)
			if (extras.length) more.push(`Also installs: ${extras.join(', ')}`)
			if (warnings.length) more.push(warnings.join('\n'))
			if (!(await confirm('Before installing', more.join('\n\n'), 'Continue'))) return false
		}

		// a plan can already cover plugins that come later in the list
		const handled = new Set<string>()
		for (const [index, plan] of plans.entries()) {
			if (!handled.has(planned[index].id)) {
				await native('valenced.plugins.install', [plan])
				for (const action of plan.actions) handled.add(action.id)
			}
			done.push(planned[index].id)
		}
		tap()
		askReload(`Installed ${done.length} plugin${done.length === 1 ? '' : 's'}. Reload to apply it.`)
		return true
	} catch (e) {
		reportError(e, 'install plugins')
		if (done.length) askReload(`Installed ${done.length} of ${items.length}. ${errorMessage(e).split('\n')[0]}\nReload to apply the ones that worked.`)
		else showError(e)
		return false
	}
}
