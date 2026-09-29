import {
	ACTIVITY_ACTOR_TYPES,
	ACTIVITY_KINDS,
	type ListActivityInput,
} from "@docstore/shared/activity";
import { Button } from "@docstore/ui/components/button";
import { Label } from "@docstore/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@docstore/ui/components/select";
import { Switch } from "@docstore/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EyeOffIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { z } from "zod";

import { ActivityList } from "@/components/activity/activity-list";
import { DatePicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 50;

/** The filters live in the URL, so a filtered view can be shared or bookmarked. */
const activitySearchSchema = z.object({
	actorKeyId: z.string().min(1).optional().catch(undefined),
	actorType: z.enum(ACTIVITY_ACTOR_TYPES).optional().catch(undefined),
	objectId: z.string().min(1).optional().catch(undefined),
	/** Prefix ending with a dot (`document.`), or an exact action. */
	action: z.string().min(1).optional().catch(undefined),
	kind: z.enum(ACTIVITY_KINDS).optional().catch(undefined),
	sensitive: z.boolean().optional().catch(undefined),
	/** `YYYY-MM-DD`: from the start of that day, local time. */
	since: z.iso.date().optional().catch(undefined),
	page: z.coerce.number().int().min(1).optional().catch(undefined),
});
type ActivitySearch = z.infer<typeof activitySearchSchema>;

function toListInput(search: ActivitySearch): ListActivityInput {
	return {
		actorKeyId: search.actorKeyId,
		actorType: search.actorType,
		objectId: search.objectId,
		action: search.action,
		kind: search.kind,
		sensitive: search.sensitive,
		since: search.since
			? new Date(`${search.since}T00:00:00`).toISOString()
			: undefined,
		page: search.page ?? 1,
		pageSize: PAGE_SIZE,
	};
}

export const Route = createFileRoute("/_app/activity")({
	component: ActivityPage,
	validateSearch: (search): ActivitySearch =>
		activitySearchSchema.parse(search),
	loaderDeps: ({ search }) => search,
	loader: ({ context, deps }) =>
		context.queryClient.ensureQueryData(
			context.orpc.activity.list.queryOptions({ input: toListInput(deps) }),
		),
});

/** Groups of actions offered by the filter; the value is the prefix. */
const ACTION_ITEMS: Record<string, string> = {
	all: "All actions",
	"document.": "Documents",
	"party.": "Parties",
	"tag.": "Tags",
	"category.": "Categories",
	"dossier.": "Dossiers",
	"share_link.": "Share links",
	"search.": "Searches",
	"export.": "Exports",
	"api_key.": "API keys",
	"webhook.": "Webhooks",
};

const KIND_ITEMS: Record<string, string> = {
	all: "Changes and reads",
	change: "Changes",
	read: "Reads",
};

function ActivityPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/activity" });
	const ids = useId();

	const activity = useQuery(
		orpc.activity.list.queryOptions({ input: toListInput(search) }),
	);
	const keys = useQuery(orpc.apiKey.list.queryOptions({ input: {} }));

	const update = (patch: Partial<ActivitySearch>) =>
		navigate({
			search: (current) => ({ ...current, ...patch, page: undefined }),
			replace: true,
		});

	const actorItems: Record<string, string> = {
		all: "Everyone",
		"type:user": "Browser sessions",
		"type:api_key": "Any API key",
		"type:system": "docstore (pipeline, rules)",
	};
	for (const key of keys.data ?? []) {
		actorItems[`key:${key.id}`] = key.name;
	}
	const actorValue = search.actorKeyId
		? `key:${search.actorKeyId}`
		: search.actorType
			? `type:${search.actorType}`
			: "all";
	// A key deleted since keeps its entries: it is still offered as a filter.
	if (search.actorKeyId && !(actorValue in actorItems)) {
		actorItems[actorValue] = search.actorKeyId;
	}

	const onActor = (value: string | null) => {
		if (!value) return;
		if (value.startsWith("key:")) {
			update({ actorKeyId: value.slice(4), actorType: undefined });
		} else if (value.startsWith("type:")) {
			update({
				actorKeyId: undefined,
				actorType: value.slice(5) as ActivitySearch["actorType"],
			});
		} else {
			update({ actorKeyId: undefined, actorType: undefined });
		}
	};

	const filtered =
		search.actorKeyId ||
		search.actorType ||
		search.objectId ||
		search.action ||
		search.kind ||
		search.sensitive ||
		search.since;

	return (
		<>
			<PageHeader
				kicker="Traceability"
				title="Activity"
				description="Who changed or read what: every surface (web, API, MCP, automations, pipeline) writes here, and each API key is named."
				actions={
					<Button
						variant="outline"
						onClick={() =>
							navigate({
								search: {
									actorType: "api_key",
									kind: "read",
									sensitive: true,
								},
								replace: true,
							})
						}
					>
						<EyeOffIcon />
						Sensitive reads by keys
					</Button>
				}
			>
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<Select items={actorItems} value={actorValue} onValueChange={onActor}>
						<SelectTrigger aria-label="Filter by actor" className="w-56">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(actorItems).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						items={ACTION_ITEMS}
						value={search.action ?? "all"}
						onValueChange={(value) =>
							update({ action: value === "all" ? undefined : String(value) })
						}
					>
						<SelectTrigger aria-label="Filter by action" className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(ACTION_ITEMS).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						items={KIND_ITEMS}
						value={search.kind ?? "all"}
						onValueChange={(value) =>
							update({
								kind:
									value === "all"
										? undefined
										: (value as ActivitySearch["kind"]),
							})
						}
					>
						<SelectTrigger aria-label="Changes or reads" className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(KIND_ITEMS).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<DatePicker
						label="Since"
						placeholder="Since…"
						value={search.since ?? null}
						onValueChange={(value) => update({ since: value ?? undefined })}
						className="w-44"
					/>

					<div className="flex items-center gap-2">
						<Switch
							id={`${ids}-sensitive`}
							checked={search.sensitive === true}
							onCheckedChange={(checked) =>
								update({ sensitive: checked ? true : undefined })
							}
						/>
						<Label htmlFor={`${ids}-sensitive`}>Sensitive only</Label>
					</div>

					{filtered ? (
						<Button
							variant="ghost"
							onClick={() => navigate({ search: {}, replace: true })}
						>
							<XIcon />
							Clear filters
						</Button>
					) : null}
				</div>
			</PageHeader>

			<div className="px-6 py-6 lg:px-8">
				<div className="shell">
					<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
						<ActivityList
							items={activity.data?.items}
							isLoading={activity.isLoading}
							isError={activity.isError}
							onActorClick={(entry) =>
								update({
									actorKeyId: entry.actor.apiKeyId ?? undefined,
									actorType: undefined,
								})
							}
							emptyTitle={filtered ? "No matching activity" : "No activity yet"}
							emptyDescription={
								filtered
									? "Nothing matches these filters. Clear them to see everything."
									: "Changes and reads show up here as soon as someone, or some key, touches the library."
							}
						/>
						{activity.data && activity.data.total > 0 ? (
							<Pagination
								page={activity.data.page}
								pageSize={activity.data.pageSize}
								total={activity.data.total}
								totalPages={activity.data.totalPages}
								onPageChange={(page) =>
									navigate({ search: (current) => ({ ...current, page }) })
								}
								itemLabel="entry"
								itemLabelPlural="entries"
							/>
						) : null}
					</div>
				</div>
			</div>
		</>
	);
}
