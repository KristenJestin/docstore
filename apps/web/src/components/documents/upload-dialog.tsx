import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { cn } from "@docstore/ui/lib/utils";
import { ORPCError } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckCircle2Icon,
	CopyIcon,
	LoaderIcon,
	PlusIcon,
	TriangleAlertIcon,
	UploadCloudIcon,
	XIcon,
} from "lucide-react";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { DocumentTypePicker } from "@/components/document-types/document-type-picker";
import { FormField } from "@/components/form-field";
import { useForceRetry } from "@/hooks/use-force-retry";
import { apiErrorMessage, toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { client, orpc } from "@/utils/orpc";
import { MonoLabel } from "../mono-label";
import { formatFileSize } from "./document-labels";

/** Formats accepted by the ingestion pipeline (`ALLOWED_MIMES`). */
export const UPLOAD_ACCEPT =
	".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/pdf,image/png,image/jpeg,image/webp,image/tiff";

/** Delay between two `document.get` polls while the pipeline runs. */
const POLL_INTERVAL_MS = 1500;

/** Give up polling after that long; the document keeps processing server side. */
const POLL_TIMEOUT_MS = 120_000;

type UploadItemStatus =
	| "queued"
	| "uploading"
	| "processing"
	| "done"
	| "duplicate"
	| "trashed"
	| "error";

interface UploadItem {
	key: string;
	file: File;
	status: UploadItemStatus;
	/** Created document (`done`) or original one (`duplicate`, `trashed`). */
	documentId?: string;
	message?: string;
}

/**
 * The `CONFLICT` error of `file.upload` only exposes the id of the trashed
 * document inside its message: it is extracted from there to offer the
 * restore action. To be replaced by structured data on the API side.
 */
const CONFLICT_DOCUMENT_ID = /\(document ([^,)]+),/;

function itemKey(file: File, index: number): string {
	return `${index}:${file.name}:${file.size}:${file.lastModified}`;
}

const STATUS_LABELS: Record<UploadItemStatus, string> = {
	queued: "Queued",
	uploading: "Uploading…",
	processing: "Processing…",
	done: "Added",
	duplicate: "Duplicate",
	trashed: "In the trash",
	error: "Failed",
};

export interface UploadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pre-filled files, typically coming from a drop on the page. */
	initialFiles?: File[];
}

/**
 * Multi-file upload: a dropzone that shrinks to an "Add more" strip once files
 * are queued, one row per file following it from `queued` to `done`, an
 * optional document type applied to the whole batch once the pipeline is over,
 * and a batch summary.
 */
export function UploadDialog({
	open,
	onOpenChange,
	initialFiles,
}: UploadDialogProps) {
	const queryClient = useQueryClient();
	const forceRetry = useForceRetry();
	const inputId = useId();
	const typeId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [items, setItems] = useState<UploadItem[]>([]);
	const [dragging, setDragging] = useState(false);
	const [running, setRunning] = useState(false);
	const [documentTypeId, setDocumentTypeId] = useState<string | null>(null);
	const [typeStatus, setTypeStatus] = useState<string | null>(null);

	const restore = useMutation(orpc.document.restore.mutationOptions());

	useEffect(() => {
		if (!open) {
			return;
		}
		if (initialFiles && initialFiles.length > 0) {
			setItems(
				initialFiles.map((file, index) => ({
					key: itemKey(file, index),
					file,
					status: "queued" as const,
				})),
			);
		}
	}, [open, initialFiles]);

	const addFiles = (files: FileList | File[]) => {
		const incoming = Array.from(files);
		setItems((current) => {
			const known = new Set(current.map((item) => item.key));
			const added = incoming
				.map((file, index) => ({
					key: itemKey(file, current.length + index),
					file,
					status: "queued" as const,
				}))
				.filter((item) => !known.has(item.key));
			return [...current, ...added];
		});
	};

	const patch = (key: string, next: Partial<UploadItem>) => {
		setItems((current) =>
			current.map((item) => (item.key === key ? { ...item, ...next } : item)),
		);
	};

	// The upload goes through the raw oRPC client rather than `useMutation`, so
	// it is the one write of the app the global mutation cache does not see.
	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.review.key() }),
		]);
	};

	/** Waits until the pipeline stops reporting `processing` on a document. */
	const waitForProcessing = async (documentId: string): Promise<void> => {
		const deadline = Date.now() + POLL_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const detail = await client.document.get({ id: documentId });
			if (detail.status !== "processing") {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		}
	};

	const start = async () => {
		const queue = items.filter((item) => item.status === "queued");
		if (queue.length === 0) {
			return;
		}
		setRunning(true);
		setTypeStatus(null);
		const uploaded: string[] = [];

		for (const item of queue) {
			patch(item.key, { status: "uploading" });
			try {
				const result = await client.file.upload({ files: [item.file] });
				const created = result.created[0];
				const duplicate = result.duplicates[0];
				if (created) {
					patch(item.key, {
						status: "processing",
						documentId: created.documentId,
					});
					uploaded.push(created.documentId);
					// The pipeline runs asynchronously: the row stays on "Processing"
					// until the document leaves that status.
					await waitForProcessing(created.documentId);
					patch(item.key, { status: "done" });
				} else if (duplicate) {
					patch(item.key, {
						status: "duplicate",
						documentId: duplicate.duplicateOf,
					});
				} else {
					patch(item.key, { status: "error", message: "Empty response." });
				}
			} catch (error) {
				const isConflict =
					error instanceof ORPCError && error.code === "CONFLICT";
				// The raw server message is still French: it is only used to dig out
				// the trashed document id, never displayed.
				const raw = error instanceof Error ? error.message : "";
				patch(item.key, {
					status: isConflict ? "trashed" : "error",
					message: isConflict
						? "Already uploaded, currently in the trash."
						: apiErrorMessage(error, "The upload failed.").message,
					documentId: isConflict
						? (CONFLICT_DOCUMENT_ID.exec(raw)?.[1] ?? undefined)
						: undefined,
				});
			}
		}

		// The type is applied only once every document left `processing`, so the
		// detection of the pipeline never fights the manual choice.
		if (documentTypeId && uploaded.length > 0) {
			setTypeStatus(`Applying the document type to ${uploaded.length}…`);
			try {
				const applied = await forceRetry("type", (force) =>
					client.documentType.apply({
						documentTypeId,
						documentIds: uploaded,
						force,
					}),
				);
				setTypeStatus(
					applied === null
						? null
						: `Document type applied to ${countLabel(applied.applied, "document")}.`,
				);
			} catch (error) {
				setTypeStatus(null);
				toastApiError(error, "The document type could not be applied.");
			}
		}

		setRunning(false);
		await invalidate();
	};

	const onRestore = async (item: UploadItem) => {
		if (!item.documentId) {
			return;
		}
		try {
			await restore.mutateAsync({ id: item.documentId });
			patch(item.key, { status: "duplicate", message: undefined });
			toast.success("Document restored from the trash.");
		} catch (error) {
			toastApiError(error, "The document could not be restored.");
		}
	};

	/** Single close entry point: the file list always starts over from scratch. */
	const changeOpen = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setItems([]);
			setTypeStatus(null);
			setDocumentTypeId(null);
		}
	};

	const onDrop = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(false);
		if (event.dataTransfer.files.length > 0) {
			addFiles(event.dataTransfer.files);
		}
	};

	const queued = items.filter((item) => item.status === "queued").length;
	const added = items.filter((item) => item.status === "done").length;
	const duplicates = items.filter(
		(item) => item.status === "duplicate" || item.status === "trashed",
	).length;
	const failed = items.filter((item) => item.status === "error").length;
	const settled = added + duplicates + failed;
	/** Every file has been sent: the primary action becomes "Done". */
	const finished = !running && queued === 0 && settled > 0;

	const fileInput = (
		<input
			id={inputId}
			ref={inputRef}
			type="file"
			multiple
			accept={UPLOAD_ACCEPT}
			className="sr-only"
			onChange={(event) => {
				if (event.target.files) {
					addFiles(event.target.files);
				}
				event.target.value = "";
			}}
		/>
	);

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Add documents</DialogTitle>
					<DialogDescription>
						PDF, PNG, JPEG, WebP or TIFF. Each file creates a document that then
						goes through the analysis pipeline.
					</DialogDescription>
				</DialogHeader>

				{items.length === 0 ? (
					<label
						htmlFor={inputId}
						onDragOver={(event) => {
							event.preventDefault();
							setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={onDrop}
						className={cn(
							"flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-border border-dashed px-6 py-8 text-center transition-colors duration-200 ease-premium hover:bg-muted/50",
							dragging && "border-ring bg-selection",
						)}
					>
						<span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
							<UploadCloudIcon className="size-5" strokeWidth={1.5} />
						</span>
						<span className="font-semibold text-sm">Drop your files here</span>
						<span className="text-muted-foreground text-xs">
							or click to select them
						</span>
						{fileInput}
					</label>
				) : (
					<>
						{/* The zone shrinks to a strip as soon as the list has rows. */}
						<label
							htmlFor={inputId}
							onDragOver={(event) => {
								event.preventDefault();
								setDragging(true);
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={onDrop}
							className={cn(
								"flex cursor-pointer items-center gap-2 rounded-lg border border-border border-dashed px-3 py-2 text-sm transition-colors duration-200 ease-premium hover:bg-muted/50",
								dragging && "border-ring bg-selection",
							)}
						>
							<PlusIcon className="size-4 text-muted-foreground" />
							<span className="font-medium">Add more</span>
							<span className="text-muted-foreground text-xs">
								or drop them here
							</span>
							{fileInput}
						</label>

						<div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
							<div className="flex items-center justify-between">
								<MonoLabel>Files</MonoLabel>
								<span className="font-mono text-muted-foreground text-xs tabular-nums">
									{settled} / {items.length}
								</span>
							</div>
							{items.map((item) => (
								<UploadRow
									key={item.key}
									item={item}
									onRemove={() =>
										setItems((current) =>
											current.filter((entry) => entry.key !== item.key),
										)
									}
									onRestore={() => onRestore(item)}
									onOpen={() => changeOpen(false)}
								/>
							))}
						</div>
					</>
				)}

				<FormField
					label="Document type"
					htmlFor={`${typeId}-type`}
					hint="Optional, applied to the whole batch once the analysis is over."
				>
					<DocumentTypePicker
						id={`${typeId}-type`}
						value={documentTypeId}
						onValueChange={setDocumentTypeId}
						allowCreate={false}
						disabled={running}
					/>
				</FormField>

				{settled > 0 || typeStatus ? (
					<div className="flex flex-wrap items-center gap-1.5 text-xs">
						{added > 0 ? (
							<Badge tone="success">
								{countLabel(added, "document")} added
							</Badge>
						) : null}
						{duplicates > 0 ? (
							<Badge tone="info">{countLabel(duplicates, "duplicate")}</Badge>
						) : null}
						{failed > 0 ? (
							<Badge tone="danger">{countLabel(failed, "failure")}</Badge>
						) : null}
						{typeStatus ? (
							<span className="text-muted-foreground">{typeStatus}</span>
						) : null}
					</div>
				) : null}

				<DialogFooter>
					{finished ? (
						<Button onClick={() => changeOpen(false)}>Done</Button>
					) : (
						<>
							<Button variant="outline" onClick={() => changeOpen(false)}>
								Close
							</Button>
							<Button disabled={queued === 0 || running} onClick={start}>
								{running ? <LoaderIcon className="animate-spin" /> : null}
								{running
									? "Uploading…"
									: `Upload ${countLabel(queued, "file")}`}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function UploadRow({
	item,
	onRemove,
	onRestore,
	onOpen,
}: {
	item: UploadItem;
	onRemove: () => void;
	onRestore: () => void;
	onOpen: () => void;
}) {
	const busy = item.status === "uploading" || item.status === "processing";

	return (
		<div className="row-in flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2 ring-1 ring-border">
			<div className="flex items-center gap-3">
				<StatusIcon status={item.status} />
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">{item.file.name}</p>
					<p className="truncate font-mono text-muted-foreground text-xs tabular-nums">
						{formatFileSize(item.file.size)} · {STATUS_LABELS[item.status]}
						{item.message ? ` · ${item.message}` : ""}
					</p>
				</div>

				{item.status === "done" && item.documentId ? (
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/documents/$documentId"
								params={{ documentId: item.documentId }}
								onClick={onOpen}
							/>
						}
					>
						Open
					</Button>
				) : null}

				{item.status === "duplicate" && item.documentId ? (
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/documents/$documentId"
								params={{ documentId: item.documentId }}
								onClick={onOpen}
							/>
						}
					>
						Open the original
					</Button>
				) : null}

				{item.status === "trashed" ? (
					<Button variant="outline" size="sm" onClick={onRestore}>
						Restore
					</Button>
				) : null}

				{item.status === "queued" ? (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Remove ${item.file.name}`}
						onClick={onRemove}
					>
						<XIcon />
					</Button>
				) : null}
			</div>

			{busy ? (
				<div
					aria-hidden
					className="h-1 w-full overflow-hidden rounded-full bg-muted"
				>
					<div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
				</div>
			) : null}
		</div>
	);
}

function StatusIcon({ status }: { status: UploadItemStatus }) {
	if (status === "uploading" || status === "processing") {
		return <LoaderIcon className="size-4 shrink-0 animate-spin text-primary" />;
	}
	if (status === "done") {
		return (
			<CheckCircle2Icon className="size-4 shrink-0 text-tone-success-foreground" />
		);
	}
	if (status === "duplicate") {
		return <CopyIcon className="size-4 shrink-0 text-tone-info-foreground" />;
	}
	if (status === "error" || status === "trashed") {
		return (
			<TriangleAlertIcon className="size-4 shrink-0 text-tone-warning-foreground" />
		);
	}
	return <UploadCloudIcon className="size-4 shrink-0 text-muted-foreground" />;
}
