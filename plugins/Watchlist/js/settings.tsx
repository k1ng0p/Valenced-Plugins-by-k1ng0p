import { getAssetIdByName } from '@valenced/assets'
import Page from '@valenced/components/Page'
import TableRowAssetIcon from '@valenced/components/TableRowAssetIcon'
import { Design } from '@valenced/discord/design'
import { Stores } from '@valenced/discord/flux'
import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Image, ScrollView, StyleSheet, View } from 'react-native'
import {
	DefaultSettings,
	getAvatarSource,
	getUserName,
	loadUser,
	openUserProfile,
	trackUser,
	untrackUser,
} from '.'
import type { DiscordModules } from '@valenced/discord/types'
import type { PluginSettingsComponent } from '@valenced/plugins/types'
import type { ComponentProps } from 'react'
import type { Settings } from '.'

const {
	Button,
	IconButton,
	SegmentedControl,
	SegmentedControlPages,
	Stack,
	TableRow,
	TableRowGroup,
	TableSwitchRow,
	TextInput,
	useSegmentedControlState,
} = Design

const AvatarSize = 40

const styles = StyleSheet.create({
	// The control is a ScrollView, which grows to fill the column unless contained
	tabs: { flexGrow: 0 },
	pages: { flex: 1 },
	avatar: {
		width: AvatarSize,
		height: AvatarSize,
		borderRadius: AvatarSize / 2,
		overflow: 'hidden',
	},
	avatarImage: { width: '100%', height: '100%' },
})

const Toggles: {
	key: 'status' | 'activity' | 'typing' | 'messages' | 'voice' | 'screenShare'
	label: string
	icon: string
}[] = [
	{ key: 'status', label: 'Status changes', icon: 'StatusIdle' },
	{
		key: 'activity',
		label: 'Activity (playing and listening: games, music, etc.)',
		icon: 'GameControllerIcon',
	},
	{ key: 'typing', label: 'Typing', icon: 'ChatDotsIcon' },
	{ key: 'messages', label: 'New messages', icon: 'ChatIcon' },
	{ key: 'voice', label: 'Joining voice channels', icon: 'VoiceNormalIcon' },
	{ key: 'screenShare', label: 'Screen sharing', icon: 'ScreenIcon' },
]

type SettingsComponentProps = ComponentProps<
	PluginSettingsComponent<{ jsonStorage: Settings }>
>
type Storage = SettingsComponentProps['api']['jsonStorage']

function subscribeToUsers(callback: () => void) {
	const UserStore = Stores.UserStore as DiscordModules.Flux.Store
	UserStore.addChangeListener(callback)
	return () => UserStore.removeChangeListener(callback)
}

function SettingsTab({ storage }: { storage: Storage }) {
	const settings = { ...DefaultSettings, ...storage.use() }
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()

	return (
		<ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
			<Stack spacing={24}>
				<TableRowGroup title="Track & Toast">
					<TableSwitchRow
						label="Track friends"
						icon={<TableRowAssetIcon name="FriendsIcon" />}
						subLabel="Everyone on your friends list, besides the users you add"
						value={settings.friends}
						onValueChange={friends => storage.set({ friends })}
					/>
					<TableSwitchRow
						label="Show message content"
						icon={<TableRowAssetIcon name="TranscriptOutlineIcon" />}
						subLabel="Off only says that a message was sent"
						value={settings.messageContent}
						onValueChange={messageContent => storage.set({ messageContent })}
					/>
				</TableRowGroup>
				<TableRowGroup title="Tracking">
					<TableSwitchRow
						label="Servers"
						icon={<TableRowAssetIcon name="ServerIcon" />}
						subLabel="Typing, messages and voice in servers"
						value={settings.servers}
						onValueChange={servers => storage.set({ servers })}
					/>
					<TableSwitchRow
						label="DMs"
						icon={<TableRowAssetIcon name="ChatIcon" />}
						subLabel="Typing, messages and voice in DMs and group DMs"
						value={settings.dms}
						onValueChange={dms => storage.set({ dms })}
					/>
				</TableRowGroup>
				<TableRowGroup title="Notify me about">
					{Toggles.map(({ key, label, icon }) => (
						<TableSwitchRow
							key={key}
							label={label}
							icon={<TableRowAssetIcon name={icon} />}
							value={settings[key]}
							onValueChange={value => storage.set({ [key]: value })}
						/>
					))}
				</TableRowGroup>
			</Stack>
		</ScrollView>
	)
}

function UserAvatar({ id }: { id: string }) {
	const source = getAvatarSource(id)

	return (
		<View style={styles.avatar}>
			{source && <Image source={source} style={styles.avatarImage} />}
		</View>
	)
}

function UsersTab({ storage }: { storage: Storage }) {
	const { users } = { ...DefaultSettings, ...storage.use() }
	const [userId, setUserId] = useState('')
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()

	// Re-render once a user Discord hadn't loaded arrives
	useSyncExternalStore(subscribeToUsers, () => users.map(getUserName).join())

	useEffect(() => {
		for (const id of users) if (!getAvatarSource(id)) loadUser(id)
	}, [users])

	return (
		<ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
			<Stack spacing={24}>
				<TextInput
					label="Track a user by ID"
					placeholder="User ID"
					value={userId}
					onChange={setUserId}
					isClearable
				/>
				<Button
					text="Add to Watchlist"
					icon={getAssetIdByName('UserPlusIcon')}
					onPress={async () => {
						if (await trackUser(userId.trim())) setUserId('')
					}}
				/>
				<TableRowGroup title={`Tracked users (${users.length})`} hasIcons>
					{users.length ? (
						users.map(id => (
							<TableRow
								key={id}
								label={getUserName(id)}
								subLabel={id}
								icon={<UserAvatar id={id} />}
								onPress={() => openUserProfile(id)}
								trailing={
									<IconButton
										icon={getAssetIdByName('UserMinusIcon')!}
										variant="tertiary"
										size="sm"
										onPress={() => untrackUser(id)}
									/>
								}
							/>
						))
					) : (
						<TableRow label="Nobody is on your Watchlist yet" />
					)}
				</TableRowGroup>
			</Stack>
		</ScrollView>
	)
}

export default function SettingsComponent({
	api: { jsonStorage: storage },
}: SettingsComponentProps) {
	const [pageWidth, setPageWidth] = useState(0)
	const items = useMemo(
		() => [
			{
				id: 'settings',
				label: 'Settings',
				page: <SettingsTab storage={storage} />,
			},
			{ id: 'users', label: 'Users', page: <UsersTab storage={storage} /> },
		],
		[storage],
	)
	const state = useSegmentedControlState({ items, pageWidth })

	return (
		<Page>
			<View style={styles.tabs}>
				<SegmentedControl state={state} />
			</View>
			<View
				style={styles.pages}
				onLayout={event => setPageWidth(event.nativeEvent.layout.width)}
			>
				<SegmentedControlPages state={state} />
			</View>
		</Page>
	)
}
