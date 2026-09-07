import type { LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	BellIcon,
	FileTextIcon,
	FolderIcon,
	HomeIcon,
	InboxIcon,
	LayersIcon,
	SettingsIcon,
	UsersIcon,
	WorkflowIcon,
} from "lucide-react";

/** Counters shown on the right of a navigation entry. */
export type NavCounter =
	| "documents"
	| "review"
	| "parties"
	| "documentTypes"
	| "dossiers"
	| "reminders";

/**
 * Sidebar sections. `main` has no heading; `organisation` is preceded by a mono
 * label in small caps. Settings left the navigation for the sidebar footer, and
 * the automations (former "Rules") live under `/settings/automations`: the
 * "System" section is gone.
 */
export type NavSection = "main" | "organisation";

export interface NavItem {
	to: NonNullable<LinkProps["to"]>;
	label: string;
	icon: LucideIcon;
	section: NavSection;
	/** Keyboard shortcut sequence, e.g. "g d". */
	hotkey?: string;
	counter?: NavCounter;
}

/** Heading shown above each section (none for `main`). */
export const NAV_SECTIONS: { id: NavSection; label?: string }[] = [
	{ id: "main" },
	{ id: "organisation", label: "Organisation" },
];

/**
 * Main navigation. Single source for the sidebar, the keyboard shortcuts and
 * the "Go to" group of the command palette.
 *
 * Shortcut letters follow the **English** label ("g h" = home, "g p" =
 * parties, "g ," = settings), never a French mnemonic.
 */
export const NAV_ITEMS: NavItem[] = [
	{
		to: "/",
		label: "Dashboard",
		icon: HomeIcon,
		section: "main",
		hotkey: "g h",
	},
	{
		to: "/documents",
		label: "Documents",
		icon: FileTextIcon,
		section: "main",
		hotkey: "g d",
		counter: "documents",
	},
	{
		to: "/review",
		label: "Review",
		icon: InboxIcon,
		section: "main",
		hotkey: "g v",
		counter: "review",
	},
	{
		to: "/parties",
		label: "Parties",
		icon: UsersIcon,
		section: "organisation",
		hotkey: "g p",
		counter: "parties",
	},
	{
		to: "/types",
		label: "Document types",
		icon: LayersIcon,
		section: "organisation",
		hotkey: "g t",
		counter: "documentTypes",
	},
	{
		to: "/dossiers",
		label: "Dossiers",
		icon: FolderIcon,
		section: "organisation",
		hotkey: "g f",
		counter: "dossiers",
	},
	{
		to: "/reminders",
		label: "Reminders",
		icon: BellIcon,
		section: "organisation",
		hotkey: "g m",
		counter: "reminders",
	},
];

/**
 * Destinations reachable without a sidebar row: Settings is the gear of the
 * sidebar footer, and the automations are one of its tabs. They still deserve
 * a keyboard shortcut and an entry in the command palette.
 */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
	{
		to: "/settings",
		label: "Settings",
		icon: SettingsIcon,
		section: "main",
		hotkey: "g ,",
	},
	{
		to: "/settings/automations",
		label: "Automations",
		icon: WorkflowIcon,
		section: "main",
		hotkey: "g a",
	},
];

/** Everything the palette and the hotkeys navigate to. */
export const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

/** One entry of the `/settings` sub-navigation. */
export interface SettingsTab {
	to: NonNullable<LinkProps["to"]>;
	label: string;
}

/**
 * Sub-navigation of `/settings`. `/settings` itself redirects to the first
 * entry, so the sidebar gear lands on "General".
 */
export const SETTINGS_TABS: SettingsTab[] = [
	{ to: "/settings/general", label: "General" },
	{ to: "/settings/categories", label: "Categories" },
	{ to: "/settings/tags", label: "Tags" },
	{ to: "/settings/custom-fields", label: "Custom fields" },
	{ to: "/settings/automations", label: "Automations" },
	{ to: "/settings/api-keys", label: "API keys" },
	{ to: "/settings/intake-sources", label: "Intake sources" },
	{ to: "/settings/upload-links", label: "Upload links" },
	{ to: "/settings/webhooks", label: "Webhooks" },
];

/** "g d" → "D", "g ," → ",": the key shown in the sidebar shortcut chip. */
export function hotkeyBadge(hotkey: string | undefined): string | null {
	if (!hotkey) {
		return null;
	}
	const parts = hotkey.split(/\s+/);
	const last = parts.at(-1);
	return last ? last.toUpperCase() : null;
}
