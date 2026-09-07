import type { DocumentListItem } from "@docstore/shared/document";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { cn } from "@docstore/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangleIcon,
	ChevronRightIcon,
	ClockIcon,
	FileTextIcon,
	InboxIcon,
	LayersIcon,
	LockIcon,
	PlusIcon,
	UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { DateText } from "@/components/date-text";
import { DocumentTypeSuggestionList } from "@/components/document-types/document-type-suggestions";
import { DocumentRow } from "@/components/documents/document-row";
import { useUpload } from "@/components/documents/upload-provider";
import { EmptyState } from "@/components/empty-state";
import { MonoLabel } from "@/components/mono-label";
import { PageHeader } from "@/components/page-header";
import { DashboardSkeleton } from "@/components/page-skeletons";
import { PAGE_ACTIONS, usePageAction } from "@/lib/page-actions";
import { countLabel } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** Number of items shown in the dashboard lists. */
const REVIEW_PREVIEW = 5;
const RECENT_PREVIEW = 6;
const EXPIRING_PREVIEW = 5;
const OVERDUE_PREVIEW = 5;

/** How far ahead the "Expiring soon" card looks. */
const EXPIRY_WINDOW_DAYS = 90;

/** `YYYY-MM-DD`, `offsetDays` from today, in UTC. */
function isoDate(offsetDays = 0): string {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() + offsetDays);
	return date.toISOString().slice(0, 10);
}

export const Route = createFileRoute("/_app/")({
	component: DashboardPage,
	pendingComponent: DashboardSkeleton,
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			context.orpc.document.stats.queryOptions({ input: {} }),
		),
});

function DashboardPage() {
	const navigate = useNavigate();
	const { openUpload } = useUpload();

	const stats = useQuery(orpc.document.stats.queryOptions({ input: {} }));
	const parties = useQuery(
		orpc.party.list.queryOptions({ input: { page: 1, pageSize: 1 } }),
	);
	const reviewCount = useQuery(orpc.review.count.queryOptions({ input: {} }));
	const review = useQuery(
		orpc.review.list.queryOptions({
			input: { page: 1, pageSize: REVIEW_PREVIEW },
		}),
	);
	const sensitive = useQuery(
		orpc.document.list.queryOptions({
			input: { sensitive: true, page: 1, pageSize: 1, deleted: "exclude" },
		}),
	);
	const recent = useQuery(
		orpc.document.list.queryOptions({
			input: {
				page: 1,
				pageSize: RECENT_PREVIEW,
				sort: "createdAt:desc",
				deleted: "exclude",
			},
		}),
	);

	const expiring = useQuery(
		orpc.document.list.queryOptions({
			input: {
				validUntilFrom: isoDate(),
				validUntilTo: isoDate(EXPIRY_WINDOW_DAYS),
				sort: "validUntil:asc",
				page: 1,
				pageSize: EXPIRING_PREVIEW,
				deleted: "exclude",
			},
		}),
	);
	const recurringTypes = useQuery(
		orpc.documentType.list.queryOptions({
			input: { recurringOnly: true, includeDisabled: false },
		}),
	);

	usePageAction(
		PAGE_ACTIONS.create,
		useCallback(() => openUpload(), [openUpload]),
	);

	/** Documents the pipeline gave up on (`document.stats().byStatus`). */
	const failed = stats.data?.byStatus.failed ?? 0;

	const overdueTypes = (recurringTypes.data ?? [])
		.filter((item) => item.enabled && (item.stats?.missing.length ?? 0) > 0)
		.slice(0, OVERDUE_PREVIEW);

	const openDocument = (item: DocumentListItem) =>
		navigate({
			to: "/documents/$documentId",
			params: { documentId: item.id },
		});

	return (
		<>
			<PageHeader
				kicker="Overview"
				title="Dashboard"
				description="A look at the whole library: what came in, what waits for review, what expires."
				actions={
					<>
						<Link to="/documents">
							<Button variant="outline">
								All documents
								<ChevronRightIcon />
							</Button>
						</Link>
						<Button className="group" onClick={() => openUpload()}>
							<PlusIcon className="transition-transform duration-500 ease-premium group-hover:rotate-90" />
							Add
						</Button>
					</>
				}
			/>

			<div
				className={cn(
					"grid grid-cols-2 gap-4 px-6 py-6 lg:px-8",
					failed > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4",
				)}
			>
				<StatCard
					label="Documents"
					value={stats.data?.total}
					hint="in the library"
					icon={FileTextIcon}
					isLoading={stats.isLoading}
				/>
				<StatCard
					label="Parties"
					value={parties.data?.total}
					hint="people and organisations"
					icon={UsersIcon}
					isLoading={parties.isLoading}
				/>
				<StatCard
					label="Sensitive"
					value={sensitive.data?.total}
					hint="encrypted at rest"
					icon={LockIcon}
					isLoading={sensitive.isLoading}
				/>
				<StatCard
					label="Review"
					value={reviewCount.data?.count}
					hint="confidence below the threshold"
					icon={InboxIcon}
					isLoading={reviewCount.isLoading}
					highlight
				/>
				{/*
				 * The `failed` counter only appears when the pipeline actually gave
				 * up on something: an always-empty red tile would be noise.
				 */}
				{failed > 0 ? (
					<StatCard
						label="Failed"
						value={failed}
						hint="the pipeline gave up"
						icon={AlertTriangleIcon}
						isLoading={stats.isLoading}
						tone="danger"
					/>
				) : null}
			</div>

			<div className="grid grid-cols-1 gap-6 px-6 pb-8 lg:px-8 xl:grid-cols-12">
				<div className="flex flex-col gap-6 xl:col-span-7">
					<DashboardCard
						title="Review queue"
						badge={
							reviewCount.data?.count ? (
								<Badge tone="warning">{reviewCount.data.count}</Badge>
							) : null
						}
						action={
							<Link to="/review">
								<Button variant="ghost" size="sm">
									Open the queue
									<ChevronRightIcon />
								</Button>
							</Link>
						}
					>
						{review.isLoading ? (
							<ListSkeleton />
						) : (review.data?.items.length ?? 0) === 0 ? (
							<EmptyState
								size="sm"
								title="Nothing to review"
								description="Every extraction scored above the confidence threshold."
							/>
						) : (
							<ul className="divide-y divide-border border-border border-t">
								{review.data?.items.map((item) => (
									<li key={item.id}>
										<DocumentRow
											item={item}
											onOpen={openDocument}
											trailing={
												<Badge tone="warning">
													{countLabel(item.reviewReasons.length, "reason")}
												</Badge>
											}
										/>
									</li>
								))}
							</ul>
						)}
					</DashboardCard>

					<DashboardCard
						title="Recently added"
						action={
							<Link to="/documents" search={{ sort: "createdAt:desc" }}>
								<Button variant="ghost" size="sm">
									View all
									<ChevronRightIcon />
								</Button>
							</Link>
						}
					>
						{recent.isLoading ? (
							<ListSkeleton />
						) : (recent.data?.items.length ?? 0) === 0 ? (
							<EmptyState
								size="sm"
								icon={FileTextIcon}
								title="No document"
								description="Upload a first file to start the library."
								action={
									<Button variant="outline" onClick={() => openUpload()}>
										<PlusIcon />
										Add
									</Button>
								}
							/>
						) : (
							<ul className="divide-y divide-border border-border border-t">
								{recent.data?.items.map((item) => (
									<li key={item.id}>
										<DocumentRow
											item={item}
											onOpen={openDocument}
											trailing={
												<DateText
													value={item.documentDate}
													precision={item.datePrecision}
												/>
											}
										/>
									</li>
								))}
							</ul>
						)}
					</DashboardCard>
				</div>

				<div className="flex flex-col gap-6 xl:col-span-5">
					<DashboardCard
						title="Expiring soon"
						icon={ClockIcon}
						action={
							<Link to="/documents" search={{ sort: "validUntil:asc" }}>
								<Button variant="ghost" size="sm">
									View all
									<ChevronRightIcon />
								</Button>
							</Link>
						}
					>
						{expiring.isLoading ? (
							<ListSkeleton />
						) : (expiring.data?.items.length ?? 0) === 0 ? (
							<EmptyState
								size="sm"
								title="Nothing expires soon"
								description={`No document reaches its validity end within ${EXPIRY_WINDOW_DAYS} days.`}
							/>
						) : (
							<ul className="divide-y divide-border border-border border-t">
								{expiring.data?.items.map((item) => (
									<li key={item.id}>
										<DocumentRow
											item={item}
											onOpen={openDocument}
											trailing={<Badge tone="warning">Expiring</Badge>}
										/>
									</li>
								))}
							</ul>
						)}
					</DashboardCard>

					<DashboardCard
						title="Overdue periods"
						icon={AlertTriangleIcon}
						badge={
							overdueTypes.length > 0 ? (
								<Badge tone="danger">{overdueTypes.length}</Badge>
							) : null
						}
						action={
							<Link to="/types" search={{ recurring: true }}>
								<Button variant="ghost" size="sm">
									All recurring types
									<ChevronRightIcon />
								</Button>
							</Link>
						}
					>
						{recurringTypes.isLoading ? (
							<ListSkeleton />
						) : overdueTypes.length === 0 ? (
							<EmptyState
								size="sm"
								title="No gap"
								description="Every enabled recurring type has all the documents of its due periods."
							/>
						) : (
							<ul className="divide-y divide-border border-border border-t">
								{overdueTypes.map((item) => (
									<li key={item.id} className="row-in">
										<Link
											to="/types/$typeId"
											params={{ typeId: item.id }}
											className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-200 ease-premium hover:bg-muted/70"
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-semibold text-sm">
													{item.name}
												</span>
												<span className="block truncate text-muted-foreground text-xs">
													{(item.stats?.missing ?? []).slice(0, 3).join(" · ")}
												</span>
											</span>
											<Badge tone="danger">
												{item.stats?.missing.length ?? 0} missing
											</Badge>
										</Link>
									</li>
								))}
							</ul>
						)}
					</DashboardCard>

					{/*
					 * Document types are the single entry point for "the same document
					 * we keep receiving": the dashboard offers the ones the library
					 * already suggests.
					 */}
					<DashboardCard
						title="Suggested types"
						icon={LayersIcon}
						action={
							<Link to="/types" search={{}}>
								<Button variant="ghost" size="sm">
									All document types
									<ChevronRightIcon />
								</Button>
							</Link>
						}
					>
						<DocumentTypeSuggestionList />
					</DashboardCard>
				</div>
			</div>
		</>
	);
}

function StatCard({
	label,
	value,
	hint,
	icon: Icon,
	isLoading,
	highlight = false,
	tone,
}: {
	label: string;
	value: number | undefined;
	hint: string;
	icon: typeof FileTextIcon;
	isLoading: boolean;
	highlight?: boolean;
	/** Colours the counter; `highlight` is the amber form of the same idea. */
	tone?: "danger";
}) {
	const emphasised = tone === "danger" || (highlight && Boolean(value));
	return (
		<div className="shell">
			<div
				className={cn(
					"rounded-xl bg-card px-5 py-4 shadow-soft ring-1 ring-border",
					tone === "danger"
						? "ring-tone-danger-foreground/30"
						: highlight && value
							? "ring-tone-warning-foreground/30"
							: undefined,
				)}
			>
				<div className="flex items-center justify-between gap-2">
					<MonoLabel>{label}</MonoLabel>
					<Icon
						aria-hidden
						className="size-4 text-muted-foreground"
						strokeWidth={1.5}
					/>
				</div>
				{isLoading ? (
					<Skeleton className="mt-2 h-8 w-16" />
				) : (
					<p
						className={cn(
							"mt-2 font-extrabold text-2xl tabular-nums tracking-tight",
							emphasised
								? tone === "danger"
									? "text-tone-danger-foreground"
									: "text-tone-warning-foreground"
								: undefined,
						)}
					>
						{value ?? 0}
					</p>
				)}
				<p className="mt-1 text-muted-foreground text-xs">{hint}</p>
			</div>
		</div>
	);
}

function DashboardCard({
	title,
	badge,
	action,
	icon: Icon,
	children,
}: {
	title: string;
	badge?: ReactNode;
	action?: ReactNode;
	icon?: typeof FileTextIcon;
	children: ReactNode;
}) {
	return (
		<div className="shell">
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex items-center justify-between gap-3 px-4 py-3">
					<div className="flex items-center gap-2">
						{Icon ? (
							<Icon
								aria-hidden
								className="size-4 text-muted-foreground"
								strokeWidth={1.5}
							/>
						) : null}
						<h2 className="font-bold text-sm tracking-tight">{title}</h2>
						{badge}
					</div>
					{action}
				</div>
				{children}
			</div>
		</div>
	);
}

function ListSkeleton() {
	return (
		<div className="flex flex-col gap-2 p-4">
			{[0, 1, 2].map((index) => (
				<Skeleton key={index} className="h-12 w-full" />
			))}
		</div>
	);
}
