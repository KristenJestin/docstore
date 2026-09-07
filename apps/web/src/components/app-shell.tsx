import { Button } from "@docstore/ui/components/button";
import { Kbd } from "@docstore/ui/components/kbd";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@docstore/ui/components/sheet";
import { useNavigate } from "@tanstack/react-router";
import { MenuIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useHotkeys } from "@/hooks/use-hotkeys";
import { ALL_NAV_ITEMS } from "@/lib/navigation";
import { emitPageAction, PAGE_ACTIONS } from "@/lib/page-actions";

import { CommandPaletteProvider, useCommandPalette } from "./command-palette";
import { ConfirmDialogProvider } from "./confirm-dialog";
import { DocumentCommandGroups } from "./documents/document-command-groups";
import { UploadProvider, useUpload } from "./documents/upload-provider";
import { PartyCommandGroups } from "./party-command-groups";
import { ReminderBell } from "./reminders/reminder-bell";
import { Sidebar } from "./sidebar";

/**
 * Shell of the signed-in application: 256 px sidebar (collapsible below `lg`),
 * prominent search bar, command palette, confirmation dialogs and keyboard
 * shortcuts.
 */
export function AppShell({ children }: { children: ReactNode }) {
	return (
		<CommandPaletteProvider>
			<ConfirmDialogProvider>
				<UploadProvider>
					<AppShellLayout>{children}</AppShellLayout>
				</UploadProvider>
			</ConfirmDialogProvider>
		</CommandPaletteProvider>
	);
}

function AppShellLayout({ children }: { children: ReactNode }) {
	const [mobileOpen, setMobileOpen] = useState(false);
	const navigate = useNavigate();
	const { setOpen, toggle } = useCommandPalette();
	const { openUpload } = useUpload();

	useHotkeys([
		{
			keys: "mod+k",
			enableInInputs: true,
			description: "Open the command palette",
			handler: toggle,
		},
		{
			keys: "/",
			description: "Focus the search field",
			handler: () => emitPageAction(PAGE_ACTIONS.focusSearch),
		},
		{
			keys: "n",
			description: "Create an item",
			handler: () => emitPageAction(PAGE_ACTIONS.create),
		},
		...ALL_NAV_ITEMS.filter((item) => item.hotkey).map((item) => ({
			keys: item.hotkey as string,
			description: `Go to ${item.label}`,
			handler: () => {
				navigate({ to: item.to });
			},
		})),
	]);

	return (
		<div className="flex min-h-svh bg-background">
			<PartyCommandGroups />
			<DocumentCommandGroups />

			<aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-border border-r bg-sidebar lg:flex">
				<Sidebar />
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-30 border-border border-b bg-background/85 backdrop-blur-xl">
					{/* `h-header` is the single source of the offset every `top-header`
					    sticky element (table headers, tabs, preview column) uses. */}
					<div className="flex h-header items-center gap-3 px-4 lg:px-8">
						<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
							<SheetTrigger
								render={
									<Button
										variant="ghost"
										size="icon"
										aria-label="Open navigation"
										className="lg:hidden"
									/>
								}
							>
								<MenuIcon />
							</SheetTrigger>
							<SheetContent side="left" className="w-72 p-0">
								<SheetTitle className="sr-only">Navigation</SheetTitle>
								<Sidebar onNavigate={() => setMobileOpen(false)} />
							</SheetContent>
						</Sheet>

						<GlobalSearchButton onClick={() => setOpen(true)} />

						<div className="ml-auto flex items-center gap-2">
							<ReminderBell />
							<Button className="group" onClick={() => openUpload()}>
								<PlusIcon className="transition-transform duration-500 ease-premium group-hover:rotate-90" />
								Add
							</Button>
						</div>
					</div>
				</header>

				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</div>
	);
}

/** Prominent search bar: opens the command palette (Ctrl K). */
function GlobalSearchButton({ onClick }: { onClick: () => void }) {
	return (
		<div className="relative w-full max-w-2xl">
			<SearchIcon
				aria-hidden
				className="pointer-events-none absolute top-3 left-4 size-4 text-muted-foreground"
			/>
			<button
				type="button"
				onClick={onClick}
				className="h-10 w-full cursor-pointer rounded-lg bg-card pr-3 pl-11 text-left text-muted-foreground text-sm ring-1 ring-border transition-all duration-200 ease-premium hover:ring-ring/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
			>
				<span className="truncate">Search a document, a party, an amount…</span>
			</button>
			<span className="absolute top-2.5 right-3 hidden items-center gap-1 lg:flex">
				<Kbd>Ctrl</Kbd>
				<Kbd>K</Kbd>
			</span>
		</div>
	);
}
