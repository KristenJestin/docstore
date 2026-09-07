import { Skeleton } from "@docstore/ui/components/skeleton";
import { cn } from "@docstore/ui/lib/utils";
import type { ReactNode } from "react";

import { DataList, type DataListColumn } from "./data-list";

/**
 * Placeholders drawn while a page waits for its first bytes.
 *
 * Every block here reuses the container and the classes of the component it
 * stands for — `PageHeader`, `DataList`, `SettingsPanel`, the dashboard cards
 * — so the real content lands exactly where the placeholder was: no layout
 * shift when the data arrives. The shimmer is the `Skeleton` primitive, which
 * stops animating under `prefers-reduced-motion`.
 */

/** Rows the list placeholders draw by default: one screenful, never more. */
const DEFAULT_ROWS = 8;

/** `Array.from` of `length`, as a plain list of indices. */
function times(length: number): number[] {
	return Array.from({ length }, (_, index) => index);
}

/* ------------------------------------------------------------------ */
/* Page header                                                         */
/* ------------------------------------------------------------------ */

export interface PageHeaderSkeletonProps {
	/** Width of the title bar, on the scale the real titles land on. */
	titleClassName?: string;
	/** Draws the one-line description under the title. */
	description?: boolean;
	/** Number of action buttons mirrored on the right. */
	actions?: number;
	/** Filter bar, tabs or anything the real header nests under the title. */
	children?: ReactNode;
}

/** Mirror of `PageHeader`: kicker, title bar, description and actions. */
export function PageHeaderSkeleton({
	titleClassName = "w-56",
	description = true,
	actions = 1,
	children,
}: PageHeaderSkeletonProps) {
	return (
		<header className="border-border border-b px-6 pt-6 pb-6 lg:px-8 lg:pt-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0">
					<Skeleton className="h-4 w-24" />
					<Skeleton className={cn("mt-2 h-9", titleClassName)} />
					{description ? (
						<Skeleton className="mt-1.5 h-5 w-full max-w-xl" />
					) : null}
				</div>
				{actions > 0 ? (
					<div className="flex flex-wrap items-center gap-2">
						{times(actions).map((index) => (
							<Skeleton key={index} className="h-9 w-28 rounded-md" />
						))}
					</div>
				) : null}
			</div>
			{children}
		</header>
	);
}

/** Mirror of `FilterBar`: search field, filter chips and trailing control. */
export function FilterBarSkeleton({ chips = 3 }: { chips?: number }) {
	return (
		<div className="mt-6 flex flex-wrap items-center gap-2">
			<Skeleton className="h-9 w-full max-w-sm rounded-md" />
			{times(chips).map((index) => (
				<Skeleton key={index} className="h-8 w-24 rounded-md" />
			))}
			<div className="ml-auto flex items-center gap-3">
				<Skeleton className="h-9 w-44 rounded-md" />
			</div>
		</div>
	);
}

/** Mirror of the sub-navigation of `/settings`. */
export function TabsSkeleton({ tabs = 6 }: { tabs?: number }) {
	return (
		<div className="mt-6 -mb-6 flex gap-1 overflow-hidden pb-2">
			{times(tabs).map((index) => (
				<Skeleton key={index} className="h-8 w-24 shrink-0 rounded-lg" />
			))}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

/**
 * `DataList` in its loading state. Going through the real component rather
 * than a copy of its markup is what keeps the row height, the 12-column grid
 * and the double rim identical to the loaded list.
 */
export function DataListSkeleton({
	columns,
	rows = DEFAULT_ROWS,
	leading = false,
}: {
	columns: DataListColumn<never>[];
	rows?: number;
	leading?: boolean;
}) {
	return (
		<DataList<never>
			items={undefined}
			isLoading
			skeletonRows={rows}
			columns={columns}
			getKey={() => ""}
			rowLeading={leading ? () => null : undefined}
		/>
	);
}

/** Thumbnail square + title + issuer, as `DocumentTitleCell` draws them. */
function documentTitleSkeleton(): ReactNode {
	return (
		<div className="flex min-w-0 items-center gap-3">
			<Skeleton className="size-10 shrink-0 rounded-md" />
			<div className="min-w-0 flex-1">
				<Skeleton className="h-4 w-40" />
				<Skeleton className="mt-1.5 h-3 w-24" />
			</div>
		</div>
	);
}

/** Round avatar + name + aliases, as the parties list draws them. */
function avatarNameSkeleton(): ReactNode {
	return (
		<div className="flex min-w-0 items-center gap-3">
			<Skeleton className="size-8 shrink-0 rounded-full" />
			<div className="min-w-0 flex-1">
				<Skeleton className="h-4 w-40" />
				<Skeleton className="mt-1.5 h-3 w-28" />
			</div>
		</div>
	);
}

/** Rounded mark + name + category, as the document types list draws them. */
function documentTypeNameSkeleton(): ReactNode {
	return (
		<div className="flex min-w-0 items-center gap-3">
			<Skeleton className="size-8 shrink-0 rounded-lg" />
			<div className="min-w-0 flex-1">
				<Skeleton className="h-4 w-32" />
				<Skeleton className="mt-1.5 h-3 w-20" />
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

/** Mirror of the dashboard `StatCard`. */
function StatCardSkeleton() {
	return (
		<div className="shell">
			<div className="rounded-xl bg-card px-5 py-4 shadow-soft ring-1 ring-border">
				<div className="flex items-center justify-between gap-2">
					<Skeleton className="h-4 w-20" />
					<Skeleton className="size-4 rounded-sm" />
				</div>
				<Skeleton className="mt-2 h-8 w-16" />
				<Skeleton className="mt-1 h-4 w-24" />
			</div>
		</div>
	);
}

/** Mirror of a `DashboardCard`: title bar plus a few rows. */
function CardSkeleton({ rows = 3 }: { rows?: number }) {
	return (
		<div className="shell">
			<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex items-center justify-between gap-3 px-4 py-3">
					<Skeleton className="h-5 w-40" />
					<Skeleton className="h-8 w-28 rounded-md" />
				</div>
				<div className="flex flex-col gap-2 border-border border-t p-4">
					{times(rows).map((index) => (
						<Skeleton key={index} className="h-12 w-full" />
					))}
				</div>
			</div>
		</div>
	);
}

/** Mirror of a `SettingsPanel` filled with `SettingsRow`s. */
function SettingsPanelSkeleton({ rows = 3 }: { rows?: number }) {
	return (
		<section className="shell">
			<div className="rounded-xl bg-card shadow-soft ring-1 ring-border">
				<div className="flex flex-wrap items-start justify-between gap-3 border-border border-b px-4 py-3">
					<div className="min-w-0">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="mt-1 h-5 w-full max-w-lg" />
					</div>
				</div>
				<div className="divide-y divide-border">
					{times(rows).map((index) => (
						<div
							key={index}
							className="flex flex-wrap items-center justify-between gap-4 px-4 py-4"
						>
							<div className="min-w-0 max-w-md flex-1">
								<Skeleton className="h-5 w-44" />
								<Skeleton className="mt-1 h-4 w-full max-w-sm" />
							</div>
							<Skeleton className="h-9 w-40 shrink-0 rounded-md" />
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/* Whole pages                                                         */
/* ------------------------------------------------------------------ */

/** Dashboard: four stat tiles, then the 7/5 pair of card columns. */
export function DashboardSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-48" actions={2} />
			<div className="grid grid-cols-2 gap-4 px-6 py-6 lg:grid-cols-4 lg:px-8">
				{times(4).map((index) => (
					<StatCardSkeleton key={index} />
				))}
			</div>
			<div className="grid grid-cols-1 gap-6 px-6 pb-8 lg:px-8 xl:grid-cols-12">
				<div className="flex flex-col gap-6 xl:col-span-7">
					<CardSkeleton rows={4} />
					<CardSkeleton rows={4} />
				</div>
				<div className="flex flex-col gap-6 xl:col-span-5">
					<CardSkeleton />
					<CardSkeleton />
					<CardSkeleton rows={2} />
				</div>
			</div>
		</>
	);
}

/** Documents: header with filters, then rows carrying a thumbnail square. */
export function DocumentsSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-52" actions={2}>
				<FilterBarSkeleton />
			</PageHeaderSkeleton>
			<DataListSkeleton
				leading
				columns={[
					{
						id: "title",
						header: "Document",
						span: 5,
						skeleton: documentTitleSkeleton(),
						cell: () => null,
					},
					{
						id: "category",
						header: "Category",
						span: 2,
						skeleton: <Skeleton className="h-5 w-20 rounded-md" />,
						cell: () => null,
					},
					{
						id: "date",
						header: "Date",
						span: 2,
						skeleton: <Skeleton className="h-4 w-24" />,
						cell: () => null,
					},
					{
						id: "tags",
						header: "Tags",
						span: 3,
						hideBelowLg: true,
						skeleton: <Skeleton className="h-5 w-28 rounded-md" />,
						cell: () => null,
					},
				]}
			/>
		</>
	);
}

/** Review queue: the same rows as the documents list, without the tags. */
export function ReviewSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-56" actions={1}>
				<FilterBarSkeleton chips={2} />
			</PageHeaderSkeleton>
			<DataListSkeleton
				leading
				columns={[
					{
						id: "title",
						header: "Document",
						span: 5,
						skeleton: documentTitleSkeleton(),
						cell: () => null,
					},
					{
						id: "reasons",
						header: "Reasons",
						span: 4,
						skeleton: <Skeleton className="h-5 w-32 rounded-md" />,
						cell: () => null,
					},
					{
						id: "date",
						header: "Date",
						span: 3,
						align: "end",
						skeleton: <Skeleton className="h-4 w-24" />,
						cell: () => null,
					},
				]}
			/>
		</>
	);
}

/** Parties: avatar, name and status rows. */
export function PartiesSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-40" actions={2}>
				<FilterBarSkeleton chips={2} />
			</PageHeaderSkeleton>
			<DataListSkeleton
				columns={[
					{
						id: "name",
						header: "Party",
						span: 6,
						skeleton: avatarNameSkeleton(),
						cell: () => null,
					},
					{
						id: "type",
						header: "Type",
						span: 3,
						skeleton: <Skeleton className="h-5 w-24 rounded-md" />,
						cell: () => null,
					},
					{
						id: "flags",
						header: "Status",
						span: 3,
						align: "end",
						skeleton: <Skeleton className="h-5 w-20 rounded-md" />,
						cell: () => null,
					},
				]}
			/>
		</>
	);
}

/** Document types: mark, issuer, recurrence and counters. */
export function DocumentTypesSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-64" actions={1}>
				<FilterBarSkeleton chips={3} />
			</PageHeaderSkeleton>
			<DataListSkeleton
				columns={[
					{
						id: "name",
						header: "Document type",
						span: 3,
						skeleton: documentTypeNameSkeleton(),
						cell: () => null,
					},
					{
						id: "issuer",
						header: "Issuer",
						span: 2,
						hideBelowLg: true,
						skeleton: <Skeleton className="h-4 w-24" />,
						cell: () => null,
					},
					{
						id: "recurrence",
						header: "Recurrence",
						span: 4,
						skeleton: <Skeleton className="h-5 w-40 rounded-md" />,
						cell: () => null,
					},
					{
						id: "counts",
						header: "Content",
						span: 2,
						hideBelowLg: true,
						skeleton: <Skeleton className="h-5 w-24 rounded-md" />,
						cell: () => null,
					},
					{
						id: "enabled",
						header: "Enabled",
						span: 1,
						align: "end",
						skeleton: <Skeleton className="h-5 w-8 rounded-full" />,
						cell: () => null,
					},
				]}
			/>
		</>
	);
}

/** Dossiers: name, counter and dates. */
export function DossiersSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-40" actions={1}>
				<FilterBarSkeleton chips={1} />
			</PageHeaderSkeleton>
			<DataListSkeleton
				columns={[
					{
						id: "name",
						header: "Dossier",
						span: 6,
						skeleton: avatarNameSkeleton(),
						cell: () => null,
					},
					{
						id: "documents",
						header: "Documents",
						span: 3,
						skeleton: <Skeleton className="h-5 w-20 rounded-md" />,
						cell: () => null,
					},
					{
						id: "updated",
						header: "Updated",
						span: 3,
						align: "end",
						skeleton: <Skeleton className="h-4 w-24" />,
						cell: () => null,
					},
				]}
			/>
		</>
	);
}

/** Reminders: header, then the flat list of reminder rows. */
export function RemindersSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-44" actions={1}>
				<FilterBarSkeleton chips={1} />
			</PageHeaderSkeleton>
			<div className="shell mx-6 my-6 lg:mx-8">
				<div className="overflow-hidden rounded-xl bg-card shadow-soft ring-1 ring-border">
					<div className="divide-y divide-border">
						{times(DEFAULT_ROWS).map((index) => (
							<div key={index} className="flex items-center gap-3 px-4 py-3">
								<Skeleton className="size-8 shrink-0 rounded-md" />
								<div className="min-w-0 flex-1">
									<Skeleton className="h-4 w-56" />
									<Skeleton className="mt-1.5 h-3 w-32" />
								</div>
								<Skeleton className="h-8 w-24 shrink-0 rounded-md" />
							</div>
						))}
					</div>
				</div>
			</div>
		</>
	);
}

/**
 * Document detail: breadcrumb, title block, then the 7/5 split between the
 * preview column and the metadata column.
 */
export function DocumentDetailSkeleton() {
	return (
		<>
			<header className="border-border border-b px-6 pt-6 pb-6 lg:px-8 lg:pt-8">
				<Skeleton className="h-4 w-64" />
				<div className="mt-5 flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<Skeleton className="h-9 w-96" />
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<Skeleton className="h-5 w-24 rounded-md" />
							<Skeleton className="h-5 w-32 rounded-md" />
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Skeleton className="size-9 rounded-md" />
						<Skeleton className="h-9 w-28 rounded-md" />
					</div>
				</div>
			</header>
			<div className="grid grid-cols-1 gap-6 px-6 py-6 lg:px-8 xl:grid-cols-12">
				<div className="xl:col-span-7">
					<Skeleton className="h-160 w-full rounded-xl" />
				</div>
				<div className="flex flex-col gap-6 xl:col-span-5">
					<SettingsPanelSkeleton rows={4} />
					<SettingsPanelSkeleton rows={2} />
				</div>
			</div>
		</>
	);
}

/** Party, dossier and document type detail: a wide column and a side column. */
export function DetailSkeleton({
	titleClassName = "w-72",
}: {
	titleClassName?: string;
}) {
	return (
		<>
			<PageHeaderSkeleton titleClassName={titleClassName} actions={2} />
			<div className="grid grid-cols-1 gap-6 px-6 py-6 lg:px-8 xl:grid-cols-12">
				<div className="flex flex-col gap-6 xl:col-span-8">
					<CardSkeleton rows={5} />
					<CardSkeleton rows={3} />
				</div>
				<div className="flex flex-col gap-6 xl:col-span-4">
					<CardSkeleton rows={3} />
					<CardSkeleton rows={2} />
				</div>
			</div>
		</>
	);
}

/** Settings sub-page: the panels the tab is about to fill. */
export function SettingsSkeleton({ panels = 3 }: { panels?: number }) {
	return (
		<div className="mx-6 my-6 flex flex-col gap-6 lg:mx-8">
			{times(panels).map((index) => (
				<SettingsPanelSkeleton key={index} />
			))}
		</div>
	);
}

/** Settings shell: the section header, its tabs and the panels below. */
export function SettingsLayoutSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-40" actions={0}>
				<TabsSkeleton />
			</PageHeaderSkeleton>
			<SettingsSkeleton />
		</>
	);
}

/** Editor pages (automations, extraction rules): header plus a form panel. */
export function FormPageSkeleton() {
	return (
		<>
			<PageHeaderSkeleton titleClassName="w-64" actions={1} />
			<SettingsSkeleton panels={2} />
		</>
	);
}

/**
 * Fallback shape, used while a route with no dedicated placeholder loads and
 * as the page area of the shell during the session check: a header and a list,
 * which is what most pages are.
 */
export function PageSkeleton() {
	return (
		<>
			<PageHeaderSkeleton />
			<DataListSkeleton
				columns={[
					{ id: "a", span: 6, cell: () => null },
					{ id: "b", span: 3, cell: () => null },
					{ id: "c", span: 3, align: "end", cell: () => null },
				]}
			/>
		</>
	);
}
