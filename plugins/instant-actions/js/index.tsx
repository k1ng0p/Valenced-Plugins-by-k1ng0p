import { ActionSheetActionCreators, AlertActionCreators } from "@valenced/discord/actions";
import { lookupModule, lookupModules } from "@valenced/modules/finders";
import { withProps } from "@valenced/modules/finders/filters";
import { instead } from "@valenced/patcher";
import SettingsPage, { DEFAULTS } from "./settings";
import type { ReactNode } from "react";
import type { Settings } from "./settings";

const DEBUG: boolean = false;

interface IntlModule {
	intl: { string(key: unknown): string };
	t: Record<string, unknown>;
}

const intlCache = new Map<string, string | undefined>();

function resolveIntl(hash: string): string | undefined {
	if (intlCache.has(hash)) return intlCache.get(hash);
	for (const [mod] of lookupModules(withProps<IntlModule>("intl", "t"))) {
		if (!(hash in mod.t)) continue;
		let resolved: string | undefined;
		try {
			resolved = mod.intl.string(mod.t[hash]);
		} catch {}
		intlCache.set(hash, resolved);
		return resolved;
	}
	return undefined;
}

function matchesHash(text: string, hashes: readonly string[]) {
	return hashes.some((hash) => text === resolveIntl(hash));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchesTemplate(text: string, templateHash: string) {
	const template = resolveIntl(templateHash);
	if (!template) return false;
	const pattern = template.split(/\{[^}]*\}/).map(escapeRegExp).join(".*");
	return new RegExp(`^${pattern}$`).test(text);
}

const HASH = {
	deleteMessage: ["MWMcg7", "xwMqD7"],
	removeEmbed: ["4sxKOb"],
	removeEmbedsBody: ["vXZ+Fo"],
	removeAttachmentBody: ["faHmO3"],
	deleteChannel: ["8D8Rsb"],
	pinMessage: ["CvQ18w"],
	unpinMessage: ["Bse+F/"],
} as const;

const LEAVE_GROUP_TEMPLATE = "hJ5Ap4";
const DELETE_ROLE_TEMPLATE = "FiMFTZ";

const RULES: { on: keyof Settings; test: (key: string, title: string, content: string) => boolean; rest?: (props: any) => unknown }[] = [
	{ on: "autoConfirmMessage", test: (_, t) => matchesHash(t, HASH.deleteMessage) },
	{ on: "autoConfirmEmbed", test: (_, t, c) => matchesHash(t, HASH.removeEmbed) || matchesHash(c, HASH.removeEmbedsBody) },
	{ on: "autoConfirmAttachment", test: (_, _t, c) => matchesHash(c, HASH.removeAttachmentBody) },
	{ on: "autoConfirmMaskedLink", test: (k) => k === "masked-link" },
	{ on: "autoConfirmChannel", test: (_, t) => matchesHash(t, HASH.deleteChannel) },
	{
		on: "autoConfirmServer",
		test: (k) => k === "guild-action-sheet-leave-server",
		rest: (p) => p?.guild?.id && getHttp()?.del({ url: `/users/@me/guilds/${p.guild.id}`, body: { lurking: false } }),
	},
	{ on: "autoConfirmGroup", test: (_, t) => matchesTemplate(t, LEAVE_GROUP_TEMPLATE) },
	{ on: "autoConfirmRole", test: (_, t) => matchesTemplate(t, DELETE_ROLE_TEMPLATE) },
	{
		on: "autoConfirmFriend",
		test: (k) => k === "remove-friend",
		rest: (p) => p?.user?.id && getHttp()?.del({ url: `/users/@me/relationships/${p.user.id}` }),
	},
	{
		on: "autoConfirmCancelRequest",
		test: (k) => k === "cancel-friend-request",
		rest: (p) => p?.user?.id && getHttp()?.del({ url: `/users/@me/relationships/${p.user.id}` }),
	},
	{ on: "autoConfirmVoiceCall", test: (k) => k === "start-voice-call" },
	{ on: "autoConfirmPin", test: (_, t) => matchesHash(t, HASH.pinMessage) || matchesHash(t, HASH.unpinMessage) },
];

// not part of Valenced's typed Design surface, confirmed on-device via openLazy's props
interface ConfirmationSheetProps {
	userId?: string;
	onSuccess?: () => void;
}

const SHEET_RULES: { on: keyof Settings; key: string; rest: (props: ConfirmationSheetProps) => unknown }[] = [
	{ on: "autoConfirmBlock", key: "BlockConfirmationActionSheet", rest: (p) => p.userId && getHttp()?.put({ url: `/users/@me/relationships/${p.userId}`, body: { type: 2 } }) },
	{ on: "autoConfirmIgnore", key: "IgnoreConfirmationActionSheet", rest: (p) => p.userId && getHttp()?.put({ url: `/users/@me/relationships/${p.userId}/ignore` }) },
];

interface RestAPI {
	get(request: { url: string }): Promise<unknown>;
	getAPIBaseURL(): string;
	del(request: { url: string; body?: unknown }): Promise<unknown>;
	put(request: { url: string; body?: unknown }): Promise<unknown>;
}

interface AlertProps {
	title?: ReactNode;
	content?: ReactNode;
	actions?: ReactNode;
	onConfirm?: () => unknown;
}

let http: RestAPI | undefined;
const getHttp = () => (http ??= lookupModule(withProps<RestAPI>("get", "getAPIBaseURL"))[0]);

const flattenText = (node: any, depth = 0): string => {
	if (node == null || depth > 6) return "";
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map((n) => flattenText(n, depth + 1)).join(" ");
	if (typeof node === "object" && "props" in node) return flattenText(node.props?.children, depth + 1);
	return "";
};

type Btn = { variant?: string; onPress: () => unknown };
const skipVariants = new Set(["secondary", "tertiary", "secondary-overlay"]);

const collectButtons = (node: any, out: Btn[], depth = 0) => {
	if (node == null || depth > 6) return;
	if (Array.isArray(node)) return node.forEach((n) => collectButtons(n, out, depth + 1));
	if (typeof node === "object" && "props" in node) {
		if (typeof node.props?.onPress === "function") out.push({ variant: node.props.variant, onPress: node.props.onPress });
		collectButtons(node.props?.children, out, depth + 1);
	}
};

const pickConfirm = (buttons: Btn[]) => {
	if (buttons.length !== 2) return undefined;
	const destructive = buttons.find((b) => b.variant === "destructive");
	if (destructive) return destructive.onPress;
	return buttons.find((b) => !skipVariants.has(b.variant ?? ""))?.onPress;
};

export default plugin({
	jsonStorage: { default: DEFAULTS, load: true },
	start({ jsonStorage, cleanup, logger, plugin }) {
		const runRest = (sent: unknown, onDone?: () => void) => {
			Promise.resolve(sent)
				.then(() => onDone?.())
				.catch((e: unknown) => plugin.reportError(e));
		};

		cleanup(
			instead(ActionSheetActionCreators, "openLazy", (args, original) => {
				const [, key, props] = args;
				const settings = jsonStorage.cache ?? DEFAULTS;
				const rule = SHEET_RULES.find((r) => settings[r.on] && r.key === key);
				if (!rule) return original(...args);

				const sent = rule.rest(props as ConfirmationSheetProps);
				if (!sent) {
					if (DEBUG) logger?.log("no id found", rule.on, props ? Object.keys(props) : []);
					return original(...args);
				}

				runRest(sent, (props as ConfirmationSheetProps)?.onSuccess);
			}),
		);

		cleanup(
			instead(AlertActionCreators, "openAlert", (args, original) => {
				const [key, alert] = args;
				const settings = jsonStorage.cache ?? DEFAULTS;
				const props = alert?.props as AlertProps | undefined;
				const title = flattenText(props?.title);
				const content = flattenText(props?.content);
				const rule = RULES.find((r) => settings[r.on] && r.test(key, title, content));
				if (!rule) return original(...args);

				const buttons: Btn[] = [];
				collectButtons(props?.actions, buttons);
				const confirm = pickConfirm(buttons);
				if (confirm) return confirm();

				if (typeof props?.onConfirm === "function") return props.onConfirm();

				if (rule.rest) {
					const sent = rule.rest(props);
					if (sent) return runRest(sent);
					if (DEBUG) logger?.log("no id found", rule.on, props ? Object.keys(props) : []);
				}

				return original(...args);
			}),
		);
	},
	SettingsComponent: SettingsPage,
});
