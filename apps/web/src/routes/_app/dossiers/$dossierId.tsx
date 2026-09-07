import { Badge } from "@docstore/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@docstore/ui/components/breadcrumb";
import { Button } from "@docstore/ui/components/button";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	FileTextIcon,
	FolderOpenIcon,
	PencilIcon,
	PlusIcon,
	Share2Icon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { DataList } from "@/components/data-list";
import { DateText } from "@/components/date-text";
import { CategoryBadge } from "@/components/documents/document-badges";
import { DocumentTitleCell } from "@/components/documents/document-row";
import { DossierDocumentPicker } from "@/components/dossiers/dossier-document-picker";
import { DossierFormSheet } from "@/components/dossiers/dossier-form-sheet";
import { EmptyState } from "@/components/empty-state";
import { DetailSkeleton } from "@/components/page-skeletons";
import { ShareDialog } from "@/components/share/share-dialog";
import { toastApiError } from "@/lib/api-error";
import { plural } from "@/lib/plural";
import { orpc } from "@/utils/orpc";

/** Documents listed on the dossier page. */
const PAGE_SIZE = 50;

export const Route = createFileRoute("/_app/dossiers/$dossierId")({
	component: DossierDetailPage,
	pendingComponent: DetailSkeleton,
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			context.orpc.dossier.get.queryOptions({
				input: { id: params.dossierId },
			}),
		),
});

function DossierDetailPage() {
	const { dossierId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [editing, setEditing] = useState(false);
	const [picking, setPicking] = useState(false);
	const [sharing, setSharing] = useState(false);

	const dossier = useQuery(
		orpc.dossier.get.queryOptions({ input: { id: dossierId } }),
	);
	const documents = useQuery(
		orpc.document.list.queryOptions({
			input: { dossierId, page: 1, pageSize: PAGE_SIZE },
		}),
	);

	const close = useMutation(orpc.dossier.close.mutationOptions());
	const reopen = useMutation(orpc.dossier.reopen.mutationOptions());
	const remove = useMutation(orpc.dossier.delete.mutationOptions());
	const removeDocument = useMutation(
		orpc.dossier.removeDocument.mutationOptions(),
	);

	if (dossier.isLoading) {
		return (
			<div className="flex flex-col gap-4 px-6 py-8 lg:px-8">
				<Skeleton className="h-10 w-96" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}

	if (dossier.isError || !dossier.data) {
		return (
			<div className="px-6 py-8 lg:px-8">
				<EmptyState
					title="Dossier not found"
					description="This dossier may have been deleted."
					action={
						<Link to="/dossiers">
							<Button variant="outline">Back to dossiers</Button>
						</Link>
					}
				/>
			</div>
		);
	}

	const detail = dossier.data;
	const memberIds = (documents.data?.items ?? []).map((item) => item.id);

	const onToggleStatus = async () => {
		try {
			if (detail.status === "open") {
				await close.mutateAsync({ id: dossierId });
				toast.success("Dossier closed.");
			} else {
				await reopen.mutateAsync({ id: dossierId });
				toast.success("Dossier reopened.");
			}
		} catch (error) {
			toastApiError(error, "The dossier could not be updated.");
		}
	};

	const onDelete = async () => {
		const ok = await confirm({
			title: `Delete "${detail.name}"?`,
			description: "The documents themselves are left untouched.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: dossierId });
			queryClient.removeQueries({
				queryKey: orpc.dossier.get.queryKey({ input: { id: dossierId } }),
			});
			toast.success("Dossier deleted.");
			navigate({ to: "/dossiers" });
		} catch (error) {
			toastApiError(error, "The dossier could not be deleted.");
		}
	};

	const onRemoveDocument = async (documentId: string, title: string) => {
		try {
			await removeDocument.mutateAsync({ id: dossierId, documentId });
			toast.success(`"${title}" removed from the dossier.`);
		} catch (error) {
			toastApiError(error, "The document could not be removed.");
		}
	};

	return (
		<>
			<header className="border-border border-b px-6 pt-6 pb-6 lg:px-8 lg:pt-8">
				<Breadcrumb>
					<BreadcrumbList className="font-mono text-xs">
						<BreadcrumbItem>
							<BreadcrumbLink render={<Link to="/dossiers" />}>
								Dossiers
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{detail.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<div className="mt-5 flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<h1 className="font-extrabold text-3xl leading-tight tracking-tight">
							{detail.name}
						</h1>
						<div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
							<Badge tone={detail.status === "open" ? "success" : "neutral"}>
								{detail.status}
							</Badge>
							<span className="font-mono tabular-nums">
								{detail.documentCount}
							</span>
							<span>{plural(detail.documentCount, "document")}</span>
							{detail.description ? <span>· {detail.description}</span> : null}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setSharing(true)}
						>
							<Share2Icon />
							Share this dossier
						</Button>
						<Button size="sm" onClick={() => setPicking(true)}>
							<PlusIcon />
							Add documents
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
							<PencilIcon />
							Edit
						</Button>
						<Button variant="ghost" size="sm" onClick={onToggleStatus}>
							<FolderOpenIcon />
							{detail.status === "open" ? "Close" : "Reopen"}
						</Button>
						<Button variant="destructive" size="sm" onClick={onDelete}>
							<Trash2Icon />
							Delete
						</Button>
					</div>
				</div>
			</header>

			<DataList
				items={documents.data?.items}
				isLoading={documents.isLoading}
				getKey={(item) => item.id}
				columns={[
					{
						id: "title",
						header: "Document",
						span: 6,
						cell: (item) => (
							<Link
								to="/documents/$documentId"
								params={{ documentId: item.id }}
								className="block min-w-0"
							>
								<DocumentTitleCell item={item} />
							</Link>
						),
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
						id: "actions",
						header: "",
						span: 2,
						align: "end",
						cell: (item) => (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove ${item.title} from the dossier`}
								onClick={() => onRemoveDocument(item.id, item.title)}
							>
								<XIcon />
							</Button>
						),
					},
				]}
				empty={
					<EmptyState
						icon={FileTextIcon}
						title="No document"
						description="Add the documents that belong to this dossier."
						action={
							<Button variant="outline" onClick={() => setPicking(true)}>
								<PlusIcon />
								Add documents
							</Button>
						}
					/>
				}
			/>

			<DossierFormSheet
				open={editing}
				onOpenChange={setEditing}
				dossier={detail}
			/>
			<DossierDocumentPicker
				open={picking}
				onOpenChange={setPicking}
				dossierId={dossierId}
				memberIds={memberIds}
			/>
			<ShareDialog
				open={sharing}
				onOpenChange={setSharing}
				dossierId={dossierId}
				title={detail.name}
			/>
		</>
	);
}
