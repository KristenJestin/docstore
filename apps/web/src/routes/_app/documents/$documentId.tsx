import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@docstore/ui/components/breadcrumb";
import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import { Skeleton } from "@docstore/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangleIcon,
	RefreshCwIcon,
	Share2Icon,
	Trash2Icon,
	Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DateText } from "@/components/date-text";
import { DocumentStatusBadge } from "@/components/documents/document-badges";
import { FAILED_STATUS_HINT } from "@/components/documents/document-labels";
import { DocumentMetaPanel } from "@/components/documents/document-meta-panel";
import { DocumentPreview } from "@/components/documents/document-preview";
import { EmptyState } from "@/components/empty-state";
import { ShareDialog } from "@/components/share/share-dialog";
import { toastApiError } from "@/lib/api-error";
import { orpc } from "@/utils/orpc";

/** Refresh cadence while the document is being processed. */
const PROCESSING_POLL_MS = 3000;

export const Route = createFileRoute("/_app/documents/$documentId")({
	component: DocumentDetailPage,
});

function DocumentDetailPage() {
	const { documentId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [sharing, setSharing] = useState(false);

	const document = useQuery({
		...orpc.document.get.queryOptions({ input: { id: documentId } }),
		refetchInterval: (query) =>
			query.state.data?.status === "processing" ? PROCESSING_POLL_MS : false,
	});

	const trash = useMutation(orpc.document.trash.mutationOptions());
	const restore = useMutation(orpc.document.restore.mutationOptions());
	const remove = useMutation(orpc.document.deletePermanently.mutationOptions());
	const reprocess = useMutation(orpc.document.reprocess.mutationOptions());

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.review.key() }),
		]);

	if (document.isLoading) {
		return (
			<div className="flex flex-col gap-4 px-6 py-8 lg:px-8">
				<Skeleton className="h-10 w-96" />
				<Skeleton className="h-160 w-full" />
			</div>
		);
	}

	if (document.isError || !document.data) {
		return (
			<div className="px-6 py-8 lg:px-8">
				<EmptyState
					title="Document not found"
					description="This document may have been permanently deleted."
					action={
						<Link to="/documents">
							<Button variant="outline">Back to documents</Button>
						</Link>
					}
				/>
			</div>
		);
	}

	const detail = document.data;
	const trashed = detail.deletedAt !== null;

	const onTrash = async () => {
		const ok = await confirm({
			title: "Move this document to the trash?",
			description: 'It stays restorable from the "Trash" filter.',
			confirmLabel: "Move to trash",
		});
		if (!ok) {
			return;
		}
		try {
			await trash.mutateAsync({ id: detail.id });
			await invalidate();
			toast.success("Document moved to the trash.");
		} catch (error) {
			toastApiError(error, "The operation failed.");
		}
	};

	const onRestore = async () => {
		try {
			await restore.mutateAsync({ id: detail.id });
			await invalidate();
			toast.success("Document restored.");
		} catch (error) {
			toastApiError(error, "The operation failed.");
		}
	};

	const onDelete = async () => {
		const ok = await confirm({
			title: "Permanently delete this document?",
			description:
				"The files and the extracted text will be erased from storage. This cannot be undone.",
			confirmLabel: "Delete permanently",
			destructive: true,
		});
		if (!ok) {
			return;
		}
		try {
			await remove.mutateAsync({ id: detail.id });
			// Leave the page before invalidating: refetching `document.get` on an id
			// that no longer exists would raise an error.
			queryClient.removeQueries({
				queryKey: orpc.document.get.queryKey({ input: { id: detail.id } }),
			});
			toast.success("Document deleted.");
			navigate({ to: "/documents" });
			await invalidate();
		} catch (error) {
			toastApiError(error, "The document could not be deleted.");
		}
	};

	const onReprocess = async () => {
		try {
			await reprocess.mutateAsync({ id: detail.id });
			await invalidate();
			toast.success("Processing restarted.");
		} catch (error) {
			toastApiError(error, "Processing could not be restarted.");
		}
	};

	return (
		<>
			<header className="border-border border-b px-6 pt-6 pb-6 lg:px-8 lg:pt-8">
				<Breadcrumb>
					<BreadcrumbList className="font-mono text-xs">
						<BreadcrumbItem>
							<BreadcrumbLink render={<Link to="/documents" />}>
								Documents
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{detail.title}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>

				<div className="mt-5 flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						{/* A trashed document is read-only: even its title stays put. */}
						{trashed ? (
							<h1 className="font-extrabold text-3xl leading-tight tracking-tight">
								{detail.title}
							</h1>
						) : (
							<EditableTitle
								documentId={detail.id}
								title={detail.title}
								onSaved={invalidate}
							/>
						)}
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<DocumentStatusBadge status={detail.status} />
							<span className="text-muted-foreground text-sm">
								added on <DateText value={detail.createdAt} />
							</span>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{/* A sensitive document never leaves the store through a public URL. */}
						{detail.sensitive || trashed ? null : (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setSharing(true)}
							>
								<Share2Icon />
								Share
							</Button>
						)}
						{trashed ? null : (
							<Button variant="ghost" size="sm" onClick={onReprocess}>
								<RefreshCwIcon />
								Reprocess
							</Button>
						)}
						{trashed ? (
							<>
								<Button variant="outline" size="sm" onClick={onRestore}>
									<Undo2Icon />
									Restore
								</Button>
								<Button variant="destructive" size="sm" onClick={onDelete}>
									<Trash2Icon />
									Delete permanently
								</Button>
							</>
						) : (
							<Button variant="outline" size="sm" onClick={onTrash}>
								<Trash2Icon />
								Trash
							</Button>
						)}
					</div>
				</div>
				{trashed ? (
					<div
						data-testid="trashed-banner"
						className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-muted px-4 py-3 ring-1 ring-border"
					>
						<Trash2Icon aria-hidden className="size-4 text-muted-foreground" />
						<p className="min-w-0 flex-1 text-sm">
							<span className="font-semibold">
								This document is in the trash.
							</span>{" "}
							<span className="text-muted-foreground">
								Everything is read-only until it is restored.
							</span>
						</p>
						<Button variant="outline" size="sm" onClick={onRestore}>
							<Undo2Icon />
							Restore
						</Button>
					</div>
				) : null}

				{detail.status === "failed" ? (
					<div
						data-testid="failed-banner"
						className="mt-5 rounded-lg bg-tone-danger px-4 py-3 text-tone-danger-foreground"
					>
						<p className="flex items-center gap-2 font-semibold text-sm">
							<AlertTriangleIcon aria-hidden className="size-4 shrink-0" />
							Processing failed
						</p>
						<p className="mt-1 break-words text-sm">
							{detail.processingError ?? FAILED_STATUS_HINT}
						</p>
						<Button
							variant="outline"
							size="sm"
							className="mt-3"
							disabled={trashed || reprocess.isPending}
							onClick={onReprocess}
						>
							<RefreshCwIcon />
							Reprocess
						</Button>
					</div>
				) : null}
			</header>

			<div className="grid grid-cols-1 gap-6 px-6 py-6 lg:px-8 xl:grid-cols-12">
				<div className="xl:col-span-7">
					{/*
					 * The preview stays put while the metadata column scrolls: it sticks
					 * right under the shell header (`top-header`) and takes exactly one
					 * viewport minus that header (`h-below-header`), minus the page
					 * padding.
					 */}
					<div className="xl:sticky xl:top-header xl:h-below-header xl:pb-6">
						<DocumentPreview document={detail} fill />
					</div>
				</div>
				{/*
				 * `fieldset[disabled]` is the read-only mode of a trashed document:
				 * every control it holds — inputs, switches, pickers, action buttons
				 * — stops responding, while the links and the file downloads keep
				 * working. `contents` keeps the grid layout untouched.
				 */}
				<fieldset disabled={trashed} className="contents">
					<div className="xl:col-span-5">
						<DocumentMetaPanel document={detail} />
					</div>
				</fieldset>
			</div>

			<ShareDialog
				open={sharing}
				onOpenChange={setSharing}
				documentId={detail.id}
				title={detail.title}
			/>
		</>
	);
}

/** Inline editable title: click to edit, Enter or blur to commit. */
function EditableTitle({
	documentId,
	title,
	onSaved,
}: {
	documentId: string;
	title: string;
	onSaved: () => Promise<unknown>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const update = useMutation(orpc.document.update.mutationOptions());

	useEffect(() => {
		setDraft(title);
	}, [title]);

	const save = async () => {
		setEditing(false);
		const next = draft.trim();
		if (!next || next === title) {
			setDraft(title);
			return;
		}
		try {
			await update.mutateAsync({ id: documentId, title: next });
			await onSaved();
			toast.success("Title updated.");
		} catch (error) {
			setDraft(title);
			toastApiError(error, "The document could not be renamed.");
		}
	};

	if (editing) {
		return (
			<Input
				autoFocus
				aria-label="Document title"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={save}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void save();
					}
					if (event.key === "Escape") {
						setDraft(title);
						setEditing(false);
					}
				}}
				className="h-auto max-w-2xl py-1 font-extrabold text-3xl tracking-tight"
			/>
		);
	}

	return (
		<button
			type="button"
			aria-label="Edit title"
			onClick={() => setEditing(true)}
			className="cursor-text rounded-md text-left font-extrabold text-3xl leading-tight tracking-tight transition-colors duration-200 ease-premium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
		>
			{title}
		</button>
	);
}
