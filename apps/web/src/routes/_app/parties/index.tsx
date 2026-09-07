import type { Party } from "@docstore/shared/party";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CopyCheckIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DataList } from "@/components/data-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PartiesSkeleton } from "@/components/page-skeletons";
import { PartyDuplicatesPanel } from "@/components/parties/party-duplicates-panel";
import {
	needsClientFilter,
	PartyFilters,
	type PartySearch,
	partySearchSchema,
} from "@/components/parties/party-filters";
import { PartyAvatar } from "@/components/party-avatar";
import { PartyFormSheet } from "@/components/party-form-sheet";
import { PartyTypeBadge } from "@/components/party-type-badge";
import { PAGE_ACTIONS, usePageAction } from "@/lib/page-actions";
import { orpc } from "@/utils/orpc";

/** Page size of the list. */
const PAGE_SIZE = 25;

/**
 * One large page when a filter has to be applied here rather than by the API
 * (archived, household): a household never holds that many parties.
 */
const CLIENT_FILTER_PAGE_SIZE = 100;

/** Delay before the search box is written back to the URL. */
const SEARCH_DEBOUNCE_MS = 300;

export const Route = createFileRoute("/_app/parties/")({
	component: PartiesPage,
	validateSearch: (search): PartySearch => partySearchSchema.parse(search),
	pendingComponent: PartiesSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.party.list.queryOptions({
				input: { includeArchived: true, page: 1, pageSize: PAGE_SIZE },
			}),
		),
});

function PartiesPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const searchRef = useRef<HTMLInputElement>(null);

	const [query, setQuery] = useState(search.q ?? "");
	const [formOpen, setFormOpen] = useState(false);
	const [duplicatesOpen, setDuplicatesOpen] = useState(false);

	const setSearch = useCallback(
		(patch: Partial<PartySearch>) => {
			navigate({
				search: (current) => ({ ...current, ...patch, page: undefined }),
				replace: true,
			});
		},
		[navigate],
	);

	useEffect(() => {
		setQuery(search.q ?? "");
	}, [search.q]);

	useEffect(() => {
		const current = search.q ?? "";
		if (query === current) {
			return;
		}
		const timer = setTimeout(() => {
			setSearch({ q: query.trim().length > 0 ? query.trim() : undefined });
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, search.q, setSearch]);

	const clientFiltered = needsClientFilter(search);
	const page = search.page ?? 1;

	const parties = useQuery(
		orpc.party.list.queryOptions({
			input: {
				query: search.q,
				type: search.type,
				// The API only knows how to include the archived ones; keeping only
				// them (or only the household) is narrowed just below.
				includeArchived: search.archived !== false,
				page: clientFiltered ? 1 : page,
				pageSize: clientFiltered ? CLIENT_FILTER_PAGE_SIZE : PAGE_SIZE,
			},
		}),
	);

	usePageAction(
		PAGE_ACTIONS.focusSearch,
		useCallback(() => searchRef.current?.focus(), []),
	);
	usePageAction(
		PAGE_ACTIONS.create,
		useCallback(() => setFormOpen(true), []),
	);

	const matching = (parties.data?.items ?? []).filter((party) => {
		if (search.archived !== undefined) {
			if (search.archived !== (party.archivedAt !== null)) {
				return false;
			}
		} else if (party.archivedAt !== null) {
			return false;
		}
		if (
			search.household !== undefined &&
			search.household !== party.isHouseholdMember
		) {
			return false;
		}
		return true;
	});

	const items = clientFiltered
		? matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
		: matching;
	const total = clientFiltered ? matching.length : (parties.data?.total ?? 0);
	const totalPages = clientFiltered
		? Math.max(Math.ceil(total / PAGE_SIZE), 1)
		: (parties.data?.totalPages ?? 1);

	return (
		<>
			<PageHeader
				kicker="Directory"
				title="Parties"
				description="The people, companies, public bodies and associations linked to your documents."
				actions={
					<>
						<Button
							variant="outline"
							onClick={() => setDuplicatesOpen((current) => !current)}
						>
							<CopyCheckIcon />
							Find duplicates
						</Button>
						<Button onClick={() => setFormOpen(true)}>
							<PlusIcon />
							New party
						</Button>
					</>
				}
			>
				<PartyFilters
					value={search}
					onChange={setSearch}
					query={query}
					onQueryChange={setQuery}
					searchRef={searchRef}
				/>
			</PageHeader>

			{duplicatesOpen ? (
				<PartyDuplicatesPanel onClose={() => setDuplicatesOpen(false)} />
			) : null}

			<DataList<Party>
				items={items}
				isLoading={parties.isLoading}
				getKey={(party) => party.id}
				getRowLabel={(party) => `Open the ${party.name} page`}
				onRowClick={(party) =>
					navigate({
						to: "/parties/$partyId",
						params: { partyId: party.id },
					})
				}
				columns={[
					{
						id: "name",
						header: "Party",
						span: 6,
						cell: (party) => (
							<div className="flex min-w-0 items-center gap-3">
								<PartyAvatar
									name={party.name}
									logoKey={party.logoKey}
									partyId={party.id}
								/>
								<div className="min-w-0">
									<p className="truncate font-medium text-sm">{party.name}</p>
									{party.aliases.length > 0 ? (
										<p className="truncate text-muted-foreground text-xs">
											{party.aliases.join(" · ")}
										</p>
									) : null}
								</div>
							</div>
						),
					},
					{
						id: "type",
						header: "Type",
						span: 3,
						cell: (party) => <PartyTypeBadge type={party.type} />,
					},
					{
						id: "flags",
						header: "Status",
						span: 3,
						align: "end",
						cell: (party) => (
							<div className="flex flex-wrap items-center justify-end gap-1">
								{party.isHouseholdMember ? (
									<Badge tone="info">Household</Badge>
								) : null}
								{party.archivedAt ? (
									<Badge tone="neutral">Archived</Badge>
								) : null}
							</div>
						),
					},
				]}
				empty={
					<EmptyState
						icon={UsersIcon}
						title="No party"
						description={
							search.q || items.length !== total
								? "No party matches these filters."
								: "Create a first party to link your documents to their issuer."
						}
						action={
							<Button variant="outline" onClick={() => setFormOpen(true)}>
								<PlusIcon />
								New party
							</Button>
						}
					/>
				}
				pagination={
					parties.data
						? {
								page,
								pageSize: PAGE_SIZE,
								total,
								totalPages,
								onPageChange: (next) =>
									navigate({
										search: (current) => ({ ...current, page: next }),
									}),
								itemLabel: "party",
								itemLabelPlural: "parties",
							}
						: undefined
				}
			/>

			<PartyFormSheet
				open={formOpen}
				onOpenChange={setFormOpen}
				onSaved={(party) =>
					navigate({
						to: "/parties/$partyId",
						params: { partyId: party.id },
					})
				}
			/>
		</>
	);
}
