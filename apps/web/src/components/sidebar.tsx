import { Badge } from "@docstore/ui/components/badge";
import { Button, buttonVariants } from "@docstore/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@docstore/ui/components/dropdown-menu";
import { Kbd } from "@docstore/ui/components/kbd";
import { Skeleton } from "@docstore/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@docstore/ui/components/tooltip";
import { cn } from "@docstore/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { hotkeyBadge, NAV_ITEMS, NAV_SECTIONS } from "@/lib/navigation";
import { countLabel } from "@/lib/plural";
import { COUNTER_POLL_MS, counterPollOptions, orpc } from "@/utils/orpc";
import { BrandLogo } from "./brand-logo";
import { SavedSearchNav } from "./documents/saved-search-list";
import { PartyAvatar } from "./party-avatar";
import { ThemeMenuItem } from "./theme-toggle";

/** Refresh cadence of the counters while an ingestion is running. */
const PROCESSING_POLL_MS = 3000;

export interface SidebarProps {
	/** Called after a navigation (closes the mobile panel). */
	onNavigate?: () => void;
	className?: string;
}

/** Sidebar content: brand, navigation, library block, account. */
export function Sidebar({ onNavigate, className }: SidebarProps) {
	// Every counter polls on the shared idle cadence. While a document is being
	// processed its numbers move on their own, so the stats fall back to the
	// faster cadence of the list until the pipeline is done.
	const stats = useQuery({
		...orpc.document.stats.queryOptions({ input: {} }),
		...counterPollOptions,
		refetchInterval: (query) =>
			(query.state.data?.byStatus.processing ?? 0) > 0
				? PROCESSING_POLL_MS
				: COUNTER_POLL_MS,
	});
	const parties = useQuery({
		...orpc.party.list.queryOptions({ input: { page: 1, pageSize: 1 } }),
		...counterPollOptions,
	});
	const documentTypes = useQuery({
		...orpc.documentType.list.queryOptions({
			input: { recurringOnly: false, includeDisabled: true },
		}),
		...counterPollOptions,
	});
	const dossiers = useQuery({
		...orpc.dossier.list.queryOptions({ input: { includeClosed: false } }),
		...counterPollOptions,
	});
	const reminders = useQuery({
		...orpc.reminder.count.queryOptions({ input: {} }),
		...counterPollOptions,
	});

	const counters: Record<string, number | undefined> = {
		documents: stats.data?.total,
		review: stats.data?.review,
		parties: parties.data?.total,
		documentTypes: documentTypes.data?.length,
		dossiers: dossiers.data?.length,
		reminders: reminders.data?.count,
	};

	/** Enabled recurring types missing at least one period, badged in red. */
	const overdueTypes = (documentTypes.data ?? []).filter(
		(item) => item.enabled && (item.stats?.missing.length ?? 0) > 0,
	).length;

	return (
		<div className={cn("flex h-full flex-col px-4 py-5", className)}>
			<div className="px-2 pb-6">
				<BrandLogo tagline="Document management" />
			</div>

			<nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
				{NAV_SECTIONS.map((section) => (
					<div key={section.id} className="flex flex-col gap-0.5">
						{section.label ? (
							<p className="mono-label px-3 pt-5 pb-1.5 tracking-widest">
								{section.label}
							</p>
						) : null}
						{NAV_ITEMS.filter((item) => item.section === section.id).map(
							(item) => {
								const Icon = item.icon;
								const counter = item.counter
									? counters[item.counter]
									: undefined;
								const badge = hotkeyBadge(item.hotkey);
								return (
									<Link
										key={item.to}
										to={item.to}
										onClick={onNavigate}
										activeOptions={{ exact: item.to === "/" }}
										className="group/nav flex w-full items-center gap-3 rounded-lg px-3 py-2 font-medium text-muted-foreground text-sm transition-colors duration-200 ease-premium hover:bg-muted hover:text-foreground data-[status=active]:bg-selection data-[status=active]:font-semibold data-[status=active]:text-selection-foreground"
									>
										<Icon className="size-4 shrink-0" strokeWidth={1.75} />
										<span className="min-w-0 flex-1 truncate">
											{item.label}
										</span>
										{(item.counter === "review" ||
											item.counter === "reminders") &&
										counter ? (
											<Badge
												tone="warning"
												data-testid={`nav-count-${item.counter}`}
											>
												{counter}
											</Badge>
										) : item.counter === "documentTypes" && overdueTypes > 0 ? (
											<Badge
												tone="danger"
												title={`${overdueTypes} recurring types are missing a period`}
											>
												{overdueTypes}
											</Badge>
										) : counter !== undefined ? (
											<span
												data-testid={`nav-count-${item.counter}`}
												className="font-mono text-muted-foreground text-xs tabular-nums"
											>
												{counter}
											</span>
										) : badge ? (
											<Kbd className="opacity-0 transition-opacity group-hover/nav:opacity-100">
												{badge}
											</Kbd>
										) : null}
									</Link>
								);
							},
						)}
					</div>
				))}
				<SavedSearchNav onNavigate={onNavigate} />
			</nav>

			<div className="mt-4 space-y-3 border-border border-t pt-4">
				<LibraryBlock total={stats.data?.total} review={stats.data?.review} />
				<div className="flex items-center gap-1">
					<UserBlock onNavigate={onNavigate} />
					<SettingsButton onNavigate={onNavigate} />
				</div>
			</div>
		</div>
	);
}

/** "Library" block at the bottom of the bar: total volume and review queue. */
function LibraryBlock({
	total,
	review,
}: {
	total: number | undefined;
	review: number | undefined;
}) {
	const done = Math.max((total ?? 0) - (review ?? 0), 0);
	const ratio = total && total > 0 ? Math.round((done / total) * 100) : 0;

	return (
		<div className="shell">
			<div className="rounded-xl bg-card px-3 py-3 shadow-soft ring-1 ring-border">
				<div className="flex items-center justify-between gap-2">
					<p className="font-semibold text-xs">Library</p>
					<p className="font-mono text-muted-foreground text-xs tabular-nums">
						{countLabel(total ?? 0, "doc")}
					</p>
				</div>
				<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border">
					<div
						className="h-full rounded-full bg-primary transition-all duration-500 ease-premium"
						style={{ width: `${ratio}%` }}
					/>
				</div>
				<p className="mt-2 text-muted-foreground text-xs">
					{review && review > 0
						? `${review} to review`
						: "Nothing to review right now"}
				</p>
			</div>
		</div>
	);
}

/**
 * Settings gear of the footer, next to the user block. Settings left the
 * navigation list: it configures the application, it is not a place to browse.
 */
function SettingsButton({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={<Link to="/settings" onClick={onNavigate} />}
				aria-label="Settings"
				className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
			>
				<SettingsIcon />
			</TooltipTrigger>
			<TooltipContent side="top">
				Settings
				<Kbd>G</Kbd>
				<Kbd>,</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}

function UserBlock({ onNavigate }: { onNavigate?: () => void }) {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-10 w-full" />;
	}

	if (!session) {
		return (
			<Link to="/login" onClick={onNavigate}>
				<Button variant="outline" className="w-full">
					Sign in
				</Button>
			</Link>
		);
	}

	return (
		<div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={<button type="button" />}
					className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 text-left"
				>
					<PartyAvatar name={session.user.name} size="sm" />
					<span className="min-w-0 flex-1">
						<span className="block truncate font-semibold text-xs leading-tight">
							{session.user.name}
						</span>
						<span className="block truncate text-muted-foreground text-xs leading-tight">
							Household
						</span>
					</span>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-56">
					{/*
					 * `DropdownMenuLabel` is a Base UI `Menu.GroupLabel`: outside a
					 * `Menu.Group` it throws and takes the whole page down.
					 */}
					<DropdownMenuGroup>
						<DropdownMenuLabel>{session.user.email}</DropdownMenuLabel>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<ThemeMenuItem />
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() => {
							authClient.signOut({
								fetchOptions: {
									onSuccess: () => {
										navigate({ to: "/login" });
									},
								},
							});
						}}
					>
						<LogOutIcon />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
