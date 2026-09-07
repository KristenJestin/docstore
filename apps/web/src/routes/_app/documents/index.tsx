import type { DocumentListItem } from "@docstore/shared/document";
import { Button } from "@docstore/ui/components/button";
import { Checkbox } from "@docstore/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@docstore/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	BookmarkIcon,
	CopyCheckIcon,
	DownloadIcon,
	FileTextIcon,
	LayersIcon,
	MoreHorizontalIcon,
	PlusIcon,
	UploadCloudIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { DataList } from "@/components/data-list";
import { DateText } from "@/components/date-text";
import { BulkActionsBar } from "@/components/documents/bulk-actions-bar";
import { CategoryBadge, TagChip } from "@/components/documents/document-badges";
import { DocumentFilters } from "@/components/documents/document-filters";
import { DocumentTitleCell } from "@/components/documents/document-row";
import { DuplicatesPanel } from "@/components/documents/duplicates-panel";
import { SaveSearchDialog } from "@/components/documents/saved-search-list";
import { useUpload } from "@/components/documents/upload-provider";
import { EmptyState } from "@/components/empty-state";
import { ExportDialog } from "@/components/export/export-dialog";
import { PageHeader } from "@/components/page-header";
import { useFileDrop } from "@/hooks/use-file-drop";
import {
	type DocumentSearch,
	documentSearchSchema,
	toExportFilters,
	toListDocumentsInput,
	toSavedSearchFilters,
} from "@/lib/document-search";
import { PAGE_ACTIONS, usePageAction } from "@/lib/page-actions";
import { orpc } from "@/utils/orpc";

/** Refresh cadence while a document is still being processed. */
const PROCESSING_POLL_MS = 3000;

export const Route = createFileRoute("/_app/documents/")({
	component: DocumentsPage,
	validateSearch: (search): DocumentSearch =>
		documentSearchSchema.parse(search),
});

function DocumentsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const searchRef = useRef<HTMLInputElement>(null);
	const { openUpload } = useUpload();
	const [selected, setSelected] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [duplicatesOpen, setDuplicatesOpen] = useState(false);

	const documents = useQuery({
		...orpc.document.list.queryOptions({
			input: toListDocumentsInput(search),
		}),
		refetchInterval: (query) =>
			query.state.data?.items.some((item) => item.status === "processing")
				? PROCESSING_POLL_MS
				: false,
	});

	const setSearch = useCallback(
		(patch: Partial<DocumentSearch>) => {
			navigate({
				search: (current) => ({ ...current, ...patch, page: undefined }),
				replace: true,
			});
			setSelected([]);
		},
		[navigate],
	);

	const openDocument = useCallback(
		(item: DocumentListItem) => {
			navigate({
				to: "/documents/$documentId",
				params: { documentId: item.id },
			});
		},
		[navigate],
	);

	usePageAction(
		PAGE_ACTIONS.focusSearch,
		useCallback(() => searchRef.current?.focus(), []),
	);
	usePageAction(
		PAGE_ACTIONS.create,
		useCallback(() => openUpload(), [openUpload]),
	);

	const dragging = useFileDrop(
		useCallback((files: File[]) => openUpload(files), [openUpload]),
	);

	const items = documents.data?.items ?? [];
	const allSelected = items.length > 0 && selected.length === items.length;

	return (
		<>
			<PageHeader
				kicker="Library"
				title="Documents"
				description="Full-text search in the OCR content, structured filters and file upload."
				actions={
					<>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="outline"
										size="icon"
										aria-label="More actions"
									/>
								}
							>
								<MoreHorizontalIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => setSaving(true)}>
									<BookmarkIcon />
									Save search
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setExporting(true)}>
									<DownloadIcon />
									Export…
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => setDuplicatesOpen((current) => !current)}
								>
									<CopyCheckIcon />
									Find duplicates
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button className="group" onClick={() => openUpload()}>
							<PlusIcon className="transition-transform duration-500 ease-premium group-hover:rotate-90" />
							Add
						</Button>
					</>
				}
			>
				<DocumentFilters
					value={search}
					onChange={setSearch}
					searchRef={searchRef}
					total={documents.data?.total}
				/>
			</PageHeader>

			{duplicatesOpen ? (
				<DuplicatesPanel onClose={() => setDuplicatesOpen(false)} />
			) : null}

			<DataList<DocumentListItem>
				items={items}
				isLoading={documents.isLoading}
				getKey={(item) => item.id}
				getRowLabel={(item) => `Open ${item.title}`}
				onRowClick={openDocument}
				headerLeading={
					<Checkbox
						aria-label="Select all"
						checked={allSelected}
						onCheckedChange={(checked) =>
							setSelected(checked ? items.map((item) => item.id) : [])
						}
					/>
				}
				rowLeading={(item) => (
					<Checkbox
						aria-label={`Select ${item.title}`}
						checked={selected.includes(item.id)}
						onCheckedChange={(checked) =>
							setSelected((current) =>
								checked
									? [...current, item.id]
									: current.filter((id) => id !== item.id),
							)
						}
					/>
				)}
				columns={[
					{
						id: "title",
						header: "Document",
						span: 5,
						cell: (item) => <DocumentTitleCell item={item} />,
					},
					{
						id: "category",
						header: "Category",
						span: 2,
						cell: (item) => <CategoryBadge category={item.category} />,
					},
					{
						id: "date",
						header: "Date",
						span: 2,
						cell: (item) => (
							<DateText
								value={item.documentDate}
								precision={item.datePrecision}
							/>
						),
					},
					{
						id: "tags",
						header: "Tags",
						span: 3,
						hideBelowLg: true,
						cell: (item) => (
							<div className="flex flex-wrap items-center gap-1">
								{item.tags.slice(0, 3).map((tag) => (
									<TagChip key={tag.id} tag={tag} />
								))}
							</div>
						),
					},
				]}
				empty={
					<EmptyState
						icon={FileTextIcon}
						title={search.trash ? "Trash is empty" : "No document"}
						description={
							search.q
								? "No document matches this search."
								: "Upload a PDF or an image: the content is analysed and filed automatically. A document type files the ones you keep receiving on its own."
						}
						action={
							<>
								<Button variant="outline" onClick={() => openUpload()}>
									<UploadCloudIcon />
									Add documents
								</Button>
								<Button
									variant="ghost"
									nativeButton={false}
									render={<Link to="/types" search={{}} />}
								>
									<LayersIcon />
									Document types
								</Button>
							</>
						}
					/>
				}
				pagination={
					documents.data
						? {
								page: documents.data.page,
								pageSize: documents.data.pageSize,
								total: documents.data.total,
								totalPages: documents.data.totalPages,
								onPageChange: (page) =>
									navigate({
										search: (current) => ({ ...current, page }),
									}),
								itemLabel: "document",
							}
						: undefined
				}
			/>

			<BulkActionsBar
				ids={selected}
				trashed={Boolean(search.trash)}
				onClear={() => setSelected([])}
			/>

			<SaveSearchDialog
				open={saving}
				onOpenChange={setSaving}
				filters={toSavedSearchFilters(search)}
			/>
			<ExportDialog
				open={exporting}
				onOpenChange={setExporting}
				filters={toExportFilters(search)}
			/>

			{dragging ? (
				<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
					<div className="shell">
						<div className="flex flex-col items-center gap-2 rounded-xl bg-card px-10 py-8 shadow-lift ring-1 ring-border">
							<UploadCloudIcon className="size-6 text-primary" />
							<p className="font-bold text-sm tracking-tight">Drop to upload</p>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
