import { getAssetIdByName } from '@valenced/assets'
import { AlertActionCreators, ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { callNativeMethod } from '@valenced/modules/native'
import { React, ReactNative } from '@valenced/react'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'

export type AlertMode = 'all' | 'news' | 'updates' | 'off'

export type PluginKind = 'plugins' | 'themes' | 'icons'

export type Repo = { url: string; source?: string; discord?: string; badges?: string[]; kinds?: Record<string, PluginKind>; builtIn?: boolean }

export type ListedPlugin = {
	id: string
	name: string
	description?: string
	author?: string
	icon?: string
	version?: string
	size?: number
	requires?: string[]
	contributors?: string[]
	discord?: string[]
}

export type Listing = {
	name: string
	description?: string
	icon?: string
	plugins: ListedPlugin[]
	at?: number
	saved?: number
	stale?: string
	err?: string
	tooLarge?: boolean
}

export type PluginRef = { type: 'channel'; channel: string } | { type: 'version'; version: string }

export type RepoListing = {
	id: string
	name: string
	description: string
	author: string
	contributors?: string[]
	icon: string | null
	channels: Record<string, string>
	order: string[]
	versions: Record<string, { size: number }>
}

export type AvailableUpdate = { id: string; installed: string; available: string; channel: string; repo: string }

export type ValencedRepo = { url: string; enabled: boolean; internal?: boolean }

// the repository list lives on GitHub so it can change without a plugin update
export const REMOTE_LIST =
	'https://raw.githubusercontent.com/k1ng0p/Valenced-Plugins-by-k1ng0p/refs/heads/main/plugins/repository-browser/js/plugin-browser-repos.json'

export const KEY = 'RepositoryBrowser'
export const DAY = 24 * 60 * 60 * 1000
export const AVATAR_SIZE = 32
export const AVATAR_TTL = 10 * 60 * 1000
export const POLL_INTERVAL = 15 * 60 * 1000
export const RECHECK_AFTER_FOCUS = 5 * 60 * 1000
export const MAX_REQUESTS = 4
export const PAGE_SIZE = 30

const ICON_SLOT = 28
const ICON_GAP = 8
export const ICON_INDENT = ICON_SLOT + ICON_GAP

export const SORTS = {
	default: 'Default',
	name: 'A-Z',
	updated: 'Recently updated',
	newest: 'Newest',
	installed: 'Installed first',
}

export type SortKey = keyof typeof SORTS

export const ALERT_MODES: Record<AlertMode, { button: string; summary: string }> = {
	all: { button: 'New plugins and updates', summary: 'New plugins and updates to your plugins' },
	news: { button: 'New plugins only', summary: 'New plugins only' },
	updates: { button: 'Updates to my plugins', summary: 'Only updates to your plugins' },
	off: { button: 'Off', summary: 'Off' },
}

export const NOTICE =
	'The repositories listed here are made by the community and are not reviewed by Valenced or Discord. A plugin can access your account and run code inside this app. Only install plugins from authors you trust, read the source before you install, and use them at your own risk.'

export const slash = (url: string) => url.replace(/\/*$/, '/')
export const COMMUNITY_REPO = 'https://community.valenced.app/'

// comes with Valenced itself and can't be removed, so it is always listed, and always last
export const BUILT_IN_REPO: Repo = { url: slash(COMMUNITY_REPO), source: 'https://github.com/Valenced/valenced-community-plugins', badges: ['Built in Repo'], builtIn: true }
export const SELF_ID = 'k1ngop.repository-browser'
export const OWNER_ID = '641266820187160576'
export const SOURCE_URL = 'https://github.com/k1ng0p/Valenced-Plugins-by-k1ng0p/tree/main/plugins/repository-browser'

export type Note = { title?: string; text: string; level: 'info' | 'warning' | 'critical' }

let hapticsOn = true
export const setHaptics = (on: boolean) => {
	hapticsOn = on
}

// Valenced has no haptics module, so this is a short vibration, and iOS ignores the length
export function tap() {
	if (hapticsOn && ReactNative.Platform.OS === 'android') ReactNative.Vibration.vibrate(12)
}

export const BUILT_IN_NOTE = 'This repository comes built in with Valenced. It is listed here only for tracking and for the dependencies other plugins need.'
export const isBuiltIn = (url: string) => slash(url) === BUILT_IN_REPO.url

export const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))
export const isRemote = (value?: string): value is string => !!value && /^https:/.test(value)
export const errorMessage = (e: unknown): string => (e as { message?: string } | null)?.message ?? String(e)
export const hostOf = (url: string) => url.match(/^https:\/\/([^/]+)/)?.[1] ?? url
export const asObject = (value: any): Record<string, any> => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
export function friendlyError(err: string) {
	if (/network request failed|failed to fetch/i.test(err)) return "Can't reach this repository. Check your connection and the address"
	if (/timed out/i.test(err)) return 'The repository took too long to answer. Try again later'
	if (/json|unexpected (token|end|character)/i.test(err)) return 'The repository sent a broken index.json'
	if (/not a valenced repository/i.test(err)) return "This address isn't a Valenced repository, it has no plugin list"
	if (/too large/i.test(err)) return 'The repository is too large to load safely'
	const size = err.match(/^Artifact for \S+ is (\d+) bytes; the plan says (\d+)/i)
	if (size) {
		const gap = Math.abs(Number(size[1]) - Number(size[2]))
		return `The downloaded file is ${gap} bytes ${Number(size[1]) > Number(size[2]) ? 'larger' : 'smaller'} than the repository's index says. Valenced may be working from an old copy of the index: refresh the repository and try again. If it still fails, the repository has to republish its index.json`
	}
	const status = err.match(/^HTTP (\d{3})/)?.[1]
	if (status === '404') return 'Not found (404). The repository may have moved or been removed'
	if (status === '401' || status === '403') return `Access was refused (${status}). The repository may be private`
	if (status === '429') return 'Too many requests (429). Try again in a minute'
	if (status && Number(status) >= 500) return `The repository's server had a problem (${status}). Try again later`
	return err
}

function explainError(e: unknown) {
	const problems = (e as { details?: { problems?: { id: string; required?: string; installed?: boolean; enabled?: boolean }[] } } | null)?.details?.problems
	const lines = (problems ?? []).map(problem => {
		const range = problem.required ? ` ${problem.required}` : ''
		if (!problem.installed) return `${problem.id}${range} isn't installed`
		if (!problem.enabled) return `${problem.id} is installed but turned off`
		return `${problem.id}${range} doesn't match the installed version`
	})
	return lines.length ? `Needs ${lines.join('; ')}.` : friendlyError(errorMessage(e).split('\n')[0])
}
function describeError(e: unknown, info: string[] = []) {
	const raw = errorMessage(e).split('\n')[0]
	const explained = explainError(e)
	const dependencyProblems = !!(e as { details?: { problems?: unknown[] } } | null)?.details?.problems?.length
	const body = dependencyProblems || explained === raw ? explained : `${raw}\n\n${explained}`
	return [info.join('\n'), body].filter(Boolean).join('\n\n')
}

export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ago(time: number) {
	const minutes = Math.floor((Date.now() - time) / 60000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes}m ago`
	if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
	return `${Math.floor(minutes / 1440)}d ago`
}

let reporter: (error: unknown) => void = () => {}

export const bindReporter = (report: (error: unknown) => void) => {
	reporter = report
}

type Problem = { at: number; context: string; message: string; count: number }

const MAX_PROBLEMS = 20
const problems: Problem[] = []

export const recentProblems = () => problems

// returns true the first time a problem is seen, repeats only raise its counter
function record(context: string, error: unknown) {
	const message = errorMessage(error)
	const known = problems.find(item => item.context === context && item.message === message)
	if (known) {
		known.count++
		known.at = Date.now()
		return false
	}
	problems.unshift({ at: Date.now(), context, message, count: 1 })
	problems.length = Math.min(problems.length, MAX_PROBLEMS)
	return true
}

// failures that are expected now and then (offline, timeouts) are kept for diagnostics only
export const logProblem = (context: string, error: unknown) => void record(context, error)

export function clearProblems(context: string) {
	for (let index = problems.length - 1; index >= 0; index--) if (problems[index].context === context) problems.splice(index, 1)
}

// the install or enable was refused by Valenced itself (bad artifact, missing dependency), nothing is broken in this plugin
const fromHost = (error: unknown) => !!(error as { host?: boolean } | null)?.host

const WATERMARK = "Logged by k1ng_op's Repository Browser"

// logs get copied around, this says which tool wrote them
export function watermark(error: unknown, context = '') {
	const wrapped = new Error(`${context ? `${context}: ` : ''}${errorMessage(error)}\n${WATERMARK}`)
	if (error instanceof Error && error.stack) wrapped.stack = error.stack
	return wrapped
}

// every error comes with what was being done, and one that keeps coming back is only sent on once
export function reportError(error: unknown, context = '') {
	if (!record(context, error) || fromHost(error)) return
	reporter(watermark(error, context))
}

export function problemsText() {
	if (!problems.length) return ''
	const lines = problems.map(item => `${new Date(item.at).toISOString()} ${item.context || 'error'}: ${item.message}${item.count > 1 ? ` (x${item.count})` : ''}`)
	return [...lines, '', WATERMARK].join('\n')
}

export function copyToClipboard(text: string) {
	Clipboard.setString(text)
	ToastActionCreators.open('PLUGIN_BROWSER_COPIED', { text: 'Copied to clipboard', icon: lookupGeneratedIconComponent('CopyIcon') })
}

// newer Valenced wraps replies as { result } or { error }, older builds return the value itself
let wrapped = false
let probed = false

export async function native(name: string, args: unknown[] = []) {
	const reply = await (callNativeMethod as any)(name, args)
	probed = true

	const keys = reply && typeof reply === 'object' && !Array.isArray(reply) ? Object.keys(reply) : []
	if (keys.length === 1 && keys[0] === 'result') {
		wrapped = true
		return reply.result
	}
	if (keys.length === 1 && keys[0] === 'error') {
		wrapped = true
		const { message, code, details } = reply.error ?? {}
		throw Object.assign(new Error(message ?? code ?? 'Unknown error'), { code, details, host: true })
	}
	return reply
}

// the reply shape is only known after the first call, so make one if nothing has been sent yet
export async function usesEnvelope() {
	if (!probed) await native('valenced.plugins.repos.list').catch(() => {})
	return wrapped
}

export const h = (...args: any[]) => (React.createElement as any)(...args)

export const asset = (name?: string) => (name ? getAssetIdByName(name) : undefined)

export function icon(value?: string, fallback = 'ListViewIcon') {
	if (isRemote(value)) return h(ReactNative.Image, { source: { uri: value }, style: { width: 24, height: 24, borderRadius: 12 } })
	return h(Design.TableRow.Icon, { source: asset(value) ?? asset(fallback) ?? asset('ic_browse_channel') })
}

export function modal(title: string, content: string, actions: (button: any) => any[], onDismiss?: () => void) {
	const { AlertModal, AlertActionButton, Text } = Design
	AlertActionCreators.openAlert(
		`plugin-browser-${title}`,
		h(AlertModal, {
			title,
			content: h(Text, { color: 'text-default' }, content),
			actions: h(React.Fragment, null, ...actions(AlertActionButton)),
		}),
		onDismiss,
	)
}

export const inform = (title: string, text: string) => modal(title, text, Button => [h(Button, { key: 'ok', text: 'OK', variant: 'secondary' })])

export const showError = (e: unknown) => inform('Plugin Browser', explainError(e))

// action reads as "install Cabin", it names the dialog and says what the log entry was about
export function fail(e: unknown, action = '', info: string[] = []) {
	reportError(e, action)
	const stack = fromHost(e) ? undefined : (e as { stack?: string } | null)?.stack
	const details = [action, ...info, errorMessage(e), stack, WATERMARK].filter(Boolean).join('\n')
	modal(action ? `Couldn't ${action}` : 'Plugin Browser', describeError(e, info), Button => [
		h(Button, { key: 'ok', text: 'OK', variant: 'secondary' }),
		h(Button, { key: 'copy', text: 'Copy details', variant: 'tertiary', onPress: () => copyToClipboard(details) }),
	])
}

export const askReload = (text: string) =>
	modal('Reload required', text, Button => [
		h(Button, { key: 'reload', text: 'Reload', variant: 'primary', onPress: () => native('valenced.app.reload') }),
		h(Button, { key: 'later', text: 'Later', variant: 'secondary' }),
	])

export const confirm = (title: string, text: string, label = 'Install', variant = 'primary') =>
	new Promise<boolean>(done =>
		modal(
			title,
			text,
			Button => [
				h(Button, { key: 'yes', text: label, variant, onPress: () => done(true) }),
				h(Button, { key: 'no', text: 'Cancel', variant: 'secondary', onPress: () => done(false) }),
			],
			() => done(false),
		),
	)

// icon and title share a fixed-width slot so the text below lines up with the title
export const iconSlot = (content: any) => h(ReactNative.View, { style: { width: ICON_SLOT, alignItems: 'center', justifyContent: 'center', marginRight: ICON_GAP } }, content)

const parseVersion = (value: string) => value.split('.').map(part => parseInt(part, 10) || 0)

function compareVersions(a: number[], b: number[]) {
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const diff = (a[index] ?? 0) - (b[index] ?? 0)
		if (diff) return diff
	}
	return 0
}

// ranges this doesn't understand count as satisfied, so a warning only shows when it is certain
function satisfiesRange(version: string, range: string) {
	const current = parseVersion(version)
	return range.split('||').some(set =>
		set
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.every(token => {
				const match = token.match(/^(>=|<=|>|<|=)?v?(\d+(?:\.\d+)*)$/)
				if (!match) return true
				const diff = compareVersions(current, parseVersion(match[2]))
				if (match[1] === '>=') return diff >= 0
				if (match[1] === '<=') return diff <= 0
				if (match[1] === '>') return diff > 0
				if (match[1] === '<') return diff < 0
				return diff === 0
			}),
	)
}

export function compatibilityWarning(plugin: ListedPlugin, discord?: string, blocked?: string) {
	if (blocked) return blocked
	const ranges = plugin.discord
	if (!ranges?.length || !discord) return undefined
	return ranges.some(range => satisfiesRange(discord, range)) ? undefined : `No version of Discord matching ${ranges[0]} is available`
}

export const KINDS: { id: PluginKind; label: string; singular: string; plural: string }[] = [
	{ id: 'plugins', label: 'Plugins', singular: 'plugin', plural: 'plugins' },
	{ id: 'themes', label: 'Themes', singular: 'theme', plural: 'themes' },
	{ id: 'icons', label: 'Icons', singular: 'icon pack', plural: 'icon packs' },
]

// themes and icon packs are plugins that depend on the themes API
const THEMES_API = 'valenced.api.themes'

// repositories don't say what a themes API plugin contains, so the repository list can name it, otherwise the wording decides
export function kindOf(plugin: ListedPlugin, overrides?: Record<string, PluginKind>): PluginKind {
	const named = overrides?.[plugin.id]
	if (named) return named
	let kind = detected.get(plugin)
	if (!kind) {
		kind = detectKind(plugin)
		detected.set(plugin, kind)
	}
	return kind
}

// lists are drawn over and over, so the wording is only read once per listed plugin
const detected = new WeakMap<ListedPlugin, PluginKind>()

function detectKind(plugin: ListedPlugin): PluginKind {
	if (!plugin.requires?.some(entry => entry.split(' ')[0] === THEMES_API)) return 'plugins'

	const text = `${plugin.name} ${plugin.id} ${plugin.description ?? ''}`.toLowerCase()
	// font and emoji packs have no tab yet, so they stay with the plugins instead of posing as themes
	if (/emoji|emote|font|typeface/.test(text)) return 'plugins'
	if (/icon/.test(text)) return 'icons'
	return 'themes'
}
