import {
	type ActivityEntry,
	activityVerb,
	describeActivitySummary,
} from "@docstore/shared/activity";
import { Badge } from "@docstore/ui/components/badge";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { cn } from "@docstore/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	ActivityIcon,
	BotIcon,
	CogIcon,
	EyeIcon,
	KeyRoundIcon,
	type LucideIcon,
	UserIcon,
} from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { formatInstant, formatRelativeTime } from "@/lib/relative-time";

/** Icon of who acted: a person, an agent's key, or docstore itself. */
const ACTOR_ICONS: Record<ActivityEntry["actor"]["type"], LucideIcon> = {
	user: UserIcon,
	api_key: KeyRoundIcon,
	system: CogIcon,
};

function actorLabel(entry: ActivityEntry): string {
	if (entry.actor.type === "system") return "docstore";
	return entry.actor.name ?? entry.actor.apiKeyId ?? "unknown user";
}

/** The object of the entry, linked when the app has a page for it. */
function ObjectLabel({ entry }: { entry: ActivityEntry }) {
	const label =
		entry.objectLabel ??
		(entry.objectType === "search" ? "a search" : (entry.objectId ?? ""));
	if (entry.objectType === "document" && entry.objectId) {
		return (
			<Link
				to="/documents/$documentId"
				params={{ documentId: entry.objectId }}
				className="font-medium text-foreground hover:underline"
			>
				{label}
			</Link>
		);
	}
	if (entry.objectType === "party" && entry.objectId) {
		return (
			<Link
				to="/parties/$partyId"
				params={{ partyId: entry.objectId }}
				className="font-medium text-foreground hover:underline"
			>
				{label}
			</Link>
		);
	}
	return <span className="font-medium text-foreground">{label}</span>;
}

export interface ActivityRowProps {
	entry: ActivityEntry;
	/** Hides the object: the document page already says which one. */
	hideObject?: boolean;
	/** Makes the actor a button (filter the page on that key). */
	onActorClick?: (entry: ActivityEntry) => void;
}

/**
 * One entry: who (with the key or person icon), what, on which object, the
 * short summary, and when. Reads and sensitive entries carry a badge.
 */
export function ActivityRow({
	entry,
	hideObject = false,
	onActorClick,
}: ActivityRowProps) {
	const Icon = ACTOR_ICONS[entry.actor.type];
	const summary = describeActivitySummary(entry);
	const who = actorLabel(entry);
	return (
		<li className="row-in flex items-start gap-3 px-4 py-3">
			<span
				className={cn(
					"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-border",
					entry.actor.type === "api_key"
						? "bg-selection text-selection-foreground"
						: "bg-muted text-muted-foreground",
				)}
				title={
					entry.actor.type === "api_key"
						? "API key"
						: entry.actor.type === "user"
							? "Browser session"
							: "docstore (pipeline, rules)"
				}
			>
				<Icon className="size-3.5" strokeWidth={1.75} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-muted-foreground text-sm leading-snug">
					{onActorClick && entry.actor.type === "api_key" ? (
						<button
							type="button"
							className="font-medium text-foreground hover:underline"
							onClick={() => onActorClick(entry)}
						>
							{who}
						</button>
					) : (
						<span className="font-medium text-foreground">{who}</span>
					)}{" "}
					{activityVerb(entry.action)}
					{hideObject ? null : (
						<>
							{" "}
							<ObjectLabel entry={entry} />
						</>
					)}
				</p>
				{summary ? (
					<p className="mt-0.5 truncate font-mono text-muted-foreground text-xs">
						{summary}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1">
				<time
					dateTime={entry.createdAt.toISOString()}
					title={formatInstant(entry.createdAt)}
					className="font-mono text-muted-foreground text-xs tabular-nums"
				>
					{formatRelativeTime(entry.createdAt)}
				</time>
				<span className="flex gap-1">
					{entry.kind === "read" ? (
						<Badge tone="info">
							<EyeIcon />
							read
						</Badge>
					) : null}
					{entry.sensitive ? <Badge tone="sensitive">sensitive</Badge> : null}
				</span>
			</div>
		</li>
	);
}

export interface ActivityListProps {
	items: ActivityEntry[] | undefined;
	isLoading: boolean;
	isError?: boolean;
	hideObject?: boolean;
	onActorClick?: (entry: ActivityEntry) => void;
	/** Shown when there is nothing to list. */
	emptyTitle?: string;
	emptyDescription?: string;
	/** `sm` for the card of the document page. */
	size?: "default" | "sm";
}

/** Entries newest first, with their loading, empty and error states. */
export function ActivityList({
	items,
	isLoading,
	isError = false,
	hideObject,
	onActorClick,
	emptyTitle = "No activity",
	emptyDescription = "Nothing matches these filters yet.",
	size = "default",
}: ActivityListProps) {
	if (isLoading) {
		return (
			<div className="flex flex-col gap-2 p-4">
				{[0, 1, 2].map((index) => (
					<Skeleton key={index} className="h-12 w-full" />
				))}
			</div>
		);
	}
	if (isError) {
		return (
			<EmptyState
				size="sm"
				icon={BotIcon}
				title="The activity could not be loaded"
				description="Try again in a moment."
			/>
		);
	}
	if (!items || items.length === 0) {
		return (
			<EmptyState
				size={size}
				icon={ActivityIcon}
				title={emptyTitle}
				description={emptyDescription}
			/>
		);
	}
	return (
		<ul className="divide-y divide-border">
			{items.map((entry) => (
				<ActivityRow
					key={entry.id}
					entry={entry}
					hideObject={hideObject}
					onActorClick={onActorClick}
				/>
			))}
		</ul>
	);
}
