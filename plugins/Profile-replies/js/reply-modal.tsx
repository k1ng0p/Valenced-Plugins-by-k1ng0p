import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

interface ReplySheetProps {
	name: string
	subject: string
	quote: string
	onSend(text: string): void
}

const styles = StyleSheet.create({
	body: {
		gap: 16,
		paddingBottom: 16,
	},
})

export default function ReplySheet({
	name,
	subject,
	quote,
	onSend,
}: ReplySheetProps) {
	const [text, setText] = useState('')
	const { ActionSheet, BottomSheetTitleHeader, Button, TextInput } = Design

	return (
		<ActionSheet
			keyboardShouldPersistTaps="handled"
			header={
				<BottomSheetTitleHeader
					title={`Reply to ${name}'s ${subject}`}
					subtitle={quote}
				/>
			}
		>
			<View style={styles.body}>
				<TextInput
					autoFocus
					placeholder="Your reply"
					value={text}
					onChange={setText}
				/>
				<Button
					text="Send"
					variant="primary"
					size="lg"
					disabled={!text.trim()}
					onPress={() => onSend(text.trim())}
				/>
			</View>
		</ActionSheet>
	)
}
