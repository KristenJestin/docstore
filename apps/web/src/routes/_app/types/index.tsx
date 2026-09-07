import type { DocumentTypeItem } from "@docstore/shared/document-type";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Switch } from "@docstore/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LayersIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DataList } from "@/components/data-list";
import {
	DocumentTypeMark,
	PeriodicityBadge,
	RecurrenceProgress,
} from "@/components/document-types/document-type-badges";
import {
	DocumentTypeFilters,
	type DocumentTypeSearch,
	documentTypeSearchSchema,
} from "@/components/document-types/document-type-filters";
import { DocumentTypeFormSheet } from "@/components/document-types/document-type-form-sheet";
import { DocumentTypeSuggestions } from "@/components/document-types/document-type-suggestions";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { DocumentTypesSkeleton } from "@/components/page-skeletons";
import { PartyAvatar } from "@/components/party-avatar";
import { toastApiError } from "@/lib/api-error";
import { PAGE_ACTIONS, usePageAction } from "@/lib/page-actions";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** Delay before the search box is written back to the URL. */
const SEARCH_DEBOUNCE_MS = 300;

export const Route = createFileRoute("/_app/types/")({
	validateSearch: (search): DocumentTypeSearch =>
		documentTypeSearchSchema.parse(search),
	component: DocumentTypesPage,
	pendingComponent: DocumentTypesSkeleton,
	loaderDeps: ({ search }) => ({ recurringOnly: search.recurring === true }),
	loader: ({ context, deps }) =>
		context.queryClient.ensureQueryData(
			context.orpc.documentType.list.queryOptions({
				input: { recurringOnly: deps.recurringOnly, includeDisabled: true },
			}),
		),
});

function DocumentTypesPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const searchRef = useRef<HTMLInputElement>(null);
	const [formOpen, setFormOpen] = useState(false);
	const [query, setQuery] = useState(search.q ?? "");
	const recurringOnly = search.recurring === true;

	const setSearch = useCallback(
		(patch: Partial<DocumentTypeSearch>) => {
			navigate({
				search: (current) => ({ ...current, ...patch }),
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

	const types = useQuery(
		orpc.documentType.list.queryOptions({
			input: { query: search.q, recurringOnly, includeDisabled: true },
		}),
	);
	const toggle = useMutation(orpc.documentType.toggle.mutationOptions());

	usePageAction(
		PAGE_ACTIONS.focusSearch,
		useCallback(() => searchRef.current?.focus(), []),
	);
	usePageAction(
		PAGE_ACTIONS.create,
		useCallback(() => setFormOpen(true), []),
	);

	// `documentType.list` knows neither the category nor the enabled flag, and
	// returns every type at once: both are narrowed here.
	const items = (types.data ?? []).filter((item) => {
		if (search.recurring === false && item.periodicity !== null) {
			return false;
		}
		if (search.enabled !== undefined && search.enabled !== item.enabled) {
			return false;
		}
		if (search.categoryId && search.categoryId !== item.categoryId) {
			return false;
		}
		return true;
	});

	const onToggle = async (item: DocumentTypeItem, enabled: boolean) => {
		try {
			await toggle.mutateAsync({ id: item.id, enabled });
			toast.success(
				enabled ? "Document type enabled." : "Document type disabled.",
			);
		} catch (error) {
			toastApiError(error, "The document type could not be updated.");
		}
	};

	return (
		<>
			<PageHeader
				kicker="Organisation"
				title="Document types"
				description="The documents you keep receiving: their issuer, their filing, their layouts and the periods they come back on."
				actions={
					<Button onClick={() => setFormOpen(true)}>
						<PlusIcon />
						New document type
					</Button>
				}
			>
				<DocumentTypeFilters
					value={search}
					onChange={setSearch}
					query={query}
					onQueryChange={setQuery}
					searchRef={searchRef}
				/>
			</PageHeader>

			<DocumentTypeSuggestions />

			<DataList<DocumentTypeItem>
				items={items}
				isLoading={types.isLoading}
				getKey={(item) => item.id}
				columns={[
					{
						id: "name",
						header: "Document type",
						span: 3,
						cell: (item) => (
							<div className="flex min-w-0 items-center gap-3">
								<DocumentTypeMark icon={item.icon} color={item.color} />
								<div className="min-w-0">
									<Link
										to="/types/$typeId"
										params={{ typeId: item.id }}
										title={item.name}
										className="block truncate font-semibold text-sm hover:underline"
									>
										{item.name}
									</Link>
									<span
										title={item.categoryName ?? "No category"}
										className="block truncate text-muted-foreground text-xs"
									>
										{item.categoryName ?? "No category"}
									</span>
								</div>
							</div>
						),
					},
					{
						id: "issuer",
						header: "Issuer",
						span: 2,
						hideBelowLg: true,
						cell: (item) =>
							item.issuer ? (
								<span className="flex min-w-0 items-center gap-2">
									<PartyAvatar
										name={item.issuer.name}
										logoKey={item.issuer.logoKey}
										partyId={item.issuer.id}
										size="sm"
									/>
									<span
										title={item.issuer.name}
										className="min-w-0 truncate text-sm"
									>
										{item.issuer.name}
									</span>
								</span>
							) : (
								<span className="text-muted-foreground text-xs">
									Any issuer
								</span>
							),
					},
					{
						id: "recurrence",
						header: "Recurrence",
						span: 4,
						cell: (item) =>
							item.periodicity && item.stats ? (
								<div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
									<PeriodicityBadge
										periodicity={item.periodicity}
										className="shrink-0"
									/>
									<RecurrenceProgress stats={item.stats} />
								</div>
							) : (
								<Badge tone="neutral">One-off</Badge>
							),
					},
					{
						id: "counts",
						header: "Content",
						span: 2,
						hideBelowLg: true,
						cell: (item) => (
							<span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
								<Badge tone="outline" className="shrink-0">
									{countLabel(item.layoutCount, "layout")}
								</Badge>
								<Badge tone="neutral" className="shrink-0">
									{countLabel(item.documentCount, "doc")}
								</Badge>
							</span>
						),
					},
					{
						id: "enabled",
						header: "Enabled",
						span: 1,
						align: "end",
						cell: (item) => (
							<Switch
								aria-label={`Enable ${item.name}`}
								checked={item.enabled}
								onCheckedChange={(checked) => onToggle(item, checked)}
							/>
						),
					},
				]}
				empty={
					<EmptyState
						icon={LayersIcon}
						title={recurringOnly ? "No recurring type" : "No document type"}
						description={
							recurringOnly
								? "Turn on the recurrence of a type to track the periods it should cover: payslip, rent receipt, subscription invoice."
								: "Create a type for a document you keep receiving, or start it from a document you already filed."
						}
						action={
							<Button variant="outline" onClick={() => setFormOpen(true)}>
								<PlusIcon />
								New document type
							</Button>
						}
					/>
				}
			/>

			<DocumentTypeFormSheet
				open={formOpen}
				onOpenChange={setFormOpen}
				initial={recurringOnly ? { recurring: true } : undefined}
			/>
		</>
	);
}
