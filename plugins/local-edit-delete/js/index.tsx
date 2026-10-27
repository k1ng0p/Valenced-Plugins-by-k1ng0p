import {
	ActionSheetActionCreators,
	AlertActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { getModuleWithImportedPath } from '@valenced/discord/utils/modules/finders'
import { before, instead } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { useEffect, useState } from 'react'
import { Dimensions, Image, Keyboard, ScrollView, View } from 'react-native'
import type { ComponentType, ReactElement, ReactNode } from 'react'

interface Message {
	id: string
	type: number
	state?: string
	content?: string
	channel_id?: string
	author?: {
		id?: string
		avatar?: string
		username?: string
		globalName?: string
	}
	timestamp?: { format?(pattern: string): string }
}

interface MessageCollection {
	has(id: string): boolean
	remove(id: string): unknown
	update(id: string, fn: (message: Message) => Message): unknown
}

interface ChannelMessagesCache {
	getOrCreate(channelId: string): MessageCollection | undefined
	commit(collection: unknown): void
}

interface MessageStore {
	getMessage(channelId: string, messageId: string): Message | null | undefined
	emitChange?(): void
}

interface LongPressProps {
	message?: Message
	channel?: { id: string }
}

interface Author {
	name: string
	avatarUrl?: string
	time?: string
}

type RowProps = { label?: string; variant?: string }

const ALERT_KEY = 'local-edit-preview'
const TOAST_KEY = 'local-edit-delete'
const USER_MESSAGE_TYPES = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68])

const localEdits = new Map<string, string>()
const localDeletes = new Set<string>()

let channelMessages: ChannelMessagesCache | undefined
let messageStore: MessageStore | undefined
// Message and channel of the long-press sheet that is currently open
let target: { message: Message; channelId: string } | undefined
let reportError: (error: unknown) => void = () => {}

function safely<T>(fn: () => T): T | undefined {
	try {
		return fn()
	} catch (e) {
		reportError(e)
	}
}

function toast(text: string) {
	ToastActionCreators.open(TOAST_KEY, { text })
}

function refreshMessages() {
	queueMicrotask(() => safely(() => messageStore?.emitChange?.()))
}

// Copies a message while keeping its prototype, so Discord's message
// helper methods still work on the copy.
function cloneMessage(message: Message, content: string): Message {
	const clone = Object.create(Object.getPrototypeOf(message))
	Object.defineProperties(clone, Object.getOwnPropertyDescriptors(message))
	clone.content = content
	return clone
}

function deleteLocally({ message, channelId }: NonNullable<typeof target>) {
	localDeletes.add(message.id)
	const collection = channelMessages?.getOrCreate(channelId)
	if (collection?.has(message.id)) {
		channelMessages?.commit(collection.remove(message.id))
		refreshMessages()
	}
	toast('Locally deleted!')
}

function editLocally(channelId: string, messageId: string, content: string) {
	localEdits.set(messageId, content)

	// Swap in a copy of the cached message so the author and other fields stay intact
	const collection = channelMessages?.getOrCreate(channelId)
	if (collection?.has(messageId)) {
		channelMessages?.commit(
			collection.update(messageId, message => cloneMessage(message, content)),
		)
		refreshMessages()
	}
	toast('Locally edited!')
}

function getAuthor(message: Message): Author {
	const user = message.author
	return {
		name: user?.globalName ?? user?.username ?? '',
		avatarUrl:
			user?.id && user.avatar
				? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
				: undefined,
		time: message.timestamp?.format?.('MM/DD/YYYY h:mm A'),
	}
}

const INLINE_PATTERN =
	/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|`[^`]+`)/g

function renderInline(line: string, keyPrefix: string) {
	const { Text } = Design
	const parts: ReactNode[] = []
	let last = 0
	let index = 0

	for (const match of line.matchAll(INLINE_PATTERN)) {
		const token = match[0]
		if (match.index > last) parts.push(line.slice(last, match.index))

		const body = token.replace(/^(\*\*|__|~~|\*|_|`)|(\*\*|__|~~|\*|_|`)$/g, '')
		let style: object = { fontStyle: 'italic' }
		if (token.startsWith('**') || token.startsWith('__')) {
			style = { fontWeight: 'bold' }
		} else if (token.startsWith('~~')) {
			style = { textDecorationLine: 'line-through' }
		} else if (token.startsWith('`')) {
			style = {
				fontFamily: 'monospace',
				backgroundColor: 'rgba(127,127,127,0.25)',
			}
		}

		parts.push(
			<Text
				key={`${keyPrefix}-${index++}`}
				variant="text-md/medium"
				style={style}
			>
				{body}
			</Text>,
		)
		last = match.index + token.length
	}

	if (last < line.length) parts.push(line.slice(last))
	return parts
}

function MarkdownPreview({ source }: { source: string }) {
	const { Text } = Design
	const headingVariants = [
		'heading-xl/bold',
		'heading-lg/bold',
		'heading-md/bold',
	] as const

	return source.split('\n').map((line, i) => {
		const heading = /^(#{1,3})\s+(.*)$/.exec(line)
		if (heading) {
			return (
				<Text
					key={i}
					variant={headingVariants[heading[1].length - 1]}
					style={{ marginVertical: 4 }}
				>
					{renderInline(heading[2], `h${i}`)}
				</Text>
			)
		}

		const quote = /^>\s?(.*)$/.exec(line)
		if (quote) {
			return (
				<Text
					key={i}
					variant="text-md/medium"
					style={{
						paddingLeft: 8,
						borderLeftWidth: 3,
						borderLeftColor: 'rgba(127,127,127,0.6)',
					}}
				>
					{renderInline(quote[1], `q${i}`)}
				</Text>
			)
		}

		return (
			<Text
				key={i}
				variant="text-md/medium"
				style={{ minHeight: line ? undefined : 8 }}
			>
				{renderInline(line, `l${i}`)}
			</Text>
		)
	})
}

function LocalEditDialog(props: {
	channelId: string
	messageId: string
	initial: string
	author: Author
}) {
	const { AlertModal, AlertActionButton, Text, TextArea } = Design
	const { author } = props
	const [text, setText] = useState(props.initial)
	const [typing, setTyping] = useState(false)
	const [keyboardHeight, setKeyboardHeight] = useState(0)
	const windowHeight = Dimensions.get('window').height

	useEffect(() => {
		const show = Keyboard.addListener('keyboardDidShow', e =>
			setKeyboardHeight(e.endCoordinates.height),
		)
		const hide = Keyboard.addListener('keyboardDidHide', () =>
			setKeyboardHeight(0),
		)
		return () => {
			show.remove()
			hide.remove()
		}
	}, [])

	// Space above the keyboard. Focus is the fallback if the keyboard events never fire.
	const keyboard = typing ? keyboardHeight || windowHeight * 0.4 : 0
	// Title, buttons and padding take roughly this much of the dialog
	const FIXED_PARTS = 320
	const budget = Math.max(150, windowHeight - keyboard - FIXED_PARTS)
	const previewHeight = keyboard
		? Math.round(budget * 0.5)
		: Math.round(windowHeight * 0.3)
	const inputHeight = keyboard
		? Math.round(budget * 0.5)
		: Math.round(windowHeight * 0.18)

	const close = () => AlertActionCreators.dismissAlert(ALERT_KEY)

	const save = () => {
		close()
		if (!text.length || text === props.initial) return
		// Wait for the dialog to dismiss before the message list re-renders
		setTimeout(
			() => safely(() => editLocally(props.channelId, props.messageId, text)),
			300,
		)
	}

	return (
		<AlertModal
			title="Local Edit Preview"
			// extraContent spans the full dialog width, content is indented for plain text
			extraContent={
				<View style={{ alignSelf: 'stretch', gap: 12 }}>
					{/* The preview is only as tall as the message, up to previewHeight */}
					<ScrollView
						style={{ maxHeight: previewHeight, flexGrow: 0 }}
						nestedScrollEnabled
						keyboardShouldPersistTaps="handled"
					>
						{author.name ? (
							<View
								style={{
									flexDirection: 'row',
									alignItems: 'center',
									gap: 10,
									marginBottom: 6,
								}}
							>
								{author.avatarUrl ? (
									<Image
										source={{ uri: author.avatarUrl }}
										style={{ width: 36, height: 36, borderRadius: 18 }}
									/>
								) : null}
								<Text variant="text-md/bold">{author.name}</Text>
								{author.time ? (
									<Text variant="text-xs/medium" color="text-muted">
										{author.time}
									</Text>
								) : null}
							</View>
						) : null}
						<MarkdownPreview source={text} />
					</ScrollView>
					<View style={{ height: inputHeight, overflow: 'hidden' }}>
						<TextArea
							style={{ height: inputHeight }}
							value={text}
							onChange={setText}
							onFocus={() => setTyping(true)}
							onBlur={() => setTyping(false)}
							placeholder="Message"
						/>
					</View>
				</View>
			}
			actions={
				<View style={{ gap: 8 }}>
					<AlertActionButton text="Save" variant="primary" onPress={save} />
					<AlertActionButton
						text="Cancel"
						variant="secondary"
						onPress={close}
					/>
				</View>
			}
		/>
	)
}

function openLocalEdit({ message, channelId }: NonNullable<typeof target>) {
	const initial =
		localEdits.get(message.id) ??
		messageStore?.getMessage(channelId, message.id)?.content ??
		message.content ??
		''

	ActionSheetActionCreators.hideActionSheet()
	AlertActionCreators.openAlert(
		ALERT_KEY,
		<LocalEditDialog
			channelId={channelId}
			messageId={message.id}
			initial={initial}
			author={getAuthor(message)}
		/>,
	)
}

// Long-press sheet injection

function rowPropsOf(row: unknown) {
	return (row as ReactElement<RowProps> | undefined)?.props
}

function isRowArray(arr: unknown[]) {
	const first = arr[0] as { type?: { name?: string } } | undefined
	return (
		first?.type?.name === 'ActionSheetRow' ||
		typeof rowPropsOf(first)?.label === 'string'
	)
}

// Finds every array of action sheet rows inside the rendered sheet
function findRowGroups(tree: unknown, out: unknown[][] = []): unknown[][] {
	if (!tree || typeof tree !== 'object') return out

	const children = Array.isArray(tree)
		? tree
		: (tree as ReactElement<{ children?: unknown }>).props?.children
	if (Array.isArray(children)) {
		if (children.length && isRowArray(children) && !out.includes(children))
			out.push(children)
		for (const child of children) findRowGroups(child, out)
	} else {
		findRowGroups(children, out)
	}
	return out
}

function makeRow(
	template: ReactElement,
	label: string,
	iconName: string,
	onPress: () => void,
) {
	const Row = template.type as ComponentType<Record<string, unknown>> & {
		Icon?: ComponentType<{ IconComponent: unknown }>
	}
	const Icon = Row.Icon
	const IconComponent = lookupGeneratedIconComponent(iconName)
	return (
		<Row
			key={label}
			label={label}
			icon={
				Icon && IconComponent ? <Icon IconComponent={IconComponent} /> : null
			}
			onPress={onPress}
		/>
	)
}

function injectRows(sheet: unknown, current: NonNullable<typeof target>) {
	const groups = findRowGroups(sheet)
	if (!groups.length) return

	const labelled = (row: unknown) => rowPropsOf(row)?.label != null
	const editGroup = groups.find(group => group.some(labelled))
	const deleteGroup = groups.find(group =>
		group.some(row => rowPropsOf(row)?.variant === 'danger'),
	)

	if (
		groups.length >= 2 &&
		USER_MESSAGE_TYPES.has(current.message.type) &&
		editGroup
	) {
		const template = (editGroup.find(labelled) ?? editGroup[0]) as ReactElement
		editGroup.unshift(
			makeRow(template, 'Local Edit Message', 'PencilIcon', () => {
				ActionSheetActionCreators.hideActionSheet()
				openLocalEdit(current)
			}),
		)
	}

	const group = deleteGroup ?? editGroup
	if (group) {
		const template = (group.find(labelled) ?? group[0]) as ReactElement
		group.unshift(
			makeRow(template, 'Local Delete Message', 'TrashIcon', () => {
				ActionSheetActionCreators.hideActionSheet()
				deleteLocally(current)
			}),
		)
	}
}

function wrapLongPressSheet(ns: { default: unknown }) {
	const original = ns.default
	if (typeof original !== 'function') return

	const wrapped = (props: unknown) => {
		const result = original(props)
		if (target)
			safely(() => injectRows(result, target as NonNullable<typeof target>))
		return result
	}
	ns.default = wrapped
	return () => {
		if (ns.default === wrapped) ns.default = original
	}
}

function whenImported<T>(
	cleanup: (fn: () => unknown) => void,
	path: string,
	fn: (ns: T) => void,
) {
	cleanup(getModuleWithImportedPath<T>(path, ns => safely(() => fn(ns))))
}

export default plugin({
	start({ cleanup, plugin }) {
		reportError = e => plugin.reportError(e)

		whenImported<{ default: MessageStore }>(
			cleanup,
			'stores/MessageStore.tsx',
			ns => {
				messageStore = ns.default
				cleanup(
					instead(messageStore, 'getMessage', function (args, original) {
						const result: Message | null | undefined = Reflect.apply(
							original,
							this,
							args,
						)
						if (!result) return result

						if (localDeletes.has(result.id)) return null
						const edited = localEdits.get(result.id)
						return edited != null && result.content !== edited
							? cloneMessage(result, edited)
							: result
					}),
				)
			},
		)

		whenImported<{ default: ChannelMessagesCache }>(
			cleanup,
			'lib/ChannelMessages.tsx',
			ns => {
				channelMessages = ns.default
			},
		)

		// Remember which message the long-press sheet was opened for
		whenImported<{ default: typeof ActionSheetActionCreators }>(
			cleanup,
			'modules/action_sheet/native/ActionSheetActionCreators.tsx',
			ns => {
				cleanup(
					before(ns.default, 'openLazy', args => {
						const [, key, props] = args
						const { message, channel } = props as LongPressProps
						target =
							key === 'MessageLongPressActionSheet' && message?.state === 'SENT'
								? {
										message,
										channelId: channel?.id ?? message.channel_id ?? '',
									}
								: undefined
						return args
					}),
				)
			},
		)

		whenImported<{ default: unknown }>(
			cleanup,
			'modules/messages/native/long_press/LongPressMessageActionSheet.tsx',
			ns => {
				const unwrap = wrapLongPressSheet(ns)
				if (unwrap) cleanup(unwrap)
			},
		)

		cleanup(() => {
			target = undefined
			channelMessages = undefined
			messageStore = undefined
			localEdits.clear()
			localDeletes.clear()
			reportError = () => {}
		})
	},
})
