import type { ArchiveMode, ArchiveResult } from "@docstore/shared/archive";
import {
	ARCHIVE_MODE_HINTS,
	ARCHIVE_MODE_LABELS,
	ARCHIVE_MODES,
} from "@docstore/shared/archive";
import { Badge } from "@docstore/ui/components/badge";
import { Button } from "@docstore/ui/components/button";
import { Checkbox } from "@docstore/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@docstore/ui/components/dialog";
import { Input } from "@docstore/ui/components/input";
import { cn } from "@docstore/ui/lib/utils";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CheckCircle2Icon,
	CopyIcon,
	FileArchiveIcon,
	LoaderIcon,
	MinusCircleIcon,
	PlusIcon,
	TriangleAlertIcon,
	UploadCloudIcon,
} from "lucide-react";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { DocumentTypePicker } from "@/components/document-types/document-type-picker";
import { useForceRetry } from "@/hooks/use-force-retry";
import { apiErrorMessage, toastApiError } from "@/lib/api-error";
import { countLabel } from "@/lib/plural";
import { client, orpc } from "@/utils/orpc";
import { MonoLabel } from "../mono-label";
import { formatFileSize } from "./document-labels";

/** Formats accepted by the ingestion pipeline (`ALLOWED_MIMES` + archives). */
export const UPLOAD_ACCEPT =
	".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.zip,application/pdf,image/png,image/jpeg,image/webp,image/tiff,application/zip";

/** Delay between two `document.get` polls while the pipeline runs. */
const POLL_INTERVAL_MS = 1500;

/** Give up polling after that long; the document keeps processing server side. */
const POLL_TIMEOUT_MS = 120_000;

/** Declared types and extension of an archive, as the browser reports them. */
const ARCHIVE_TYPES = new Set([
	"application/zip",
	"application/x-zip",
	"application/x-zip-compressed",
	"application/zip-compressed",
	"multipart/x-zip",
]);

export function isArchiveFile(file: File): boolean {
	return (
		ARCHIVE_TYPES.has(file.type.toLowerCase()) ||
		file.name.toLowerCase().endsWith(".zip")
	);
}

type UploadItemStatus =
	| "queued"
	/** A ZIP waiting for the user to say what to do with it. */
	| "asking"
	| "uploading"
	| "processing"
	| "done"
	| "duplicate"
	| "trashed"
	/** An archive expanded without being kept as a document of its own. */
	| "expanded"
	| "skipped"
	| "error";

interface UploadItem {
	key: string;
	/** Displayed name: the file name, or the entry path inside an archive. */
	name: string;
	/** Byte size; unknown for an entry, which the server expanded. */
	size?: number;
	file?: File;
	/** Key of the archive row this entry came out of. */
	parentKey?: string;
	/** True for the row standing for the archive itself. */
	archive?: boolean;
	status: UploadItemStatus;
	/** Created document (`done`) or original one (`duplicate`, `trashed`). */
	documentId?: string;
	/** Document type carried by the document once the pipeline settled. */
	documentTypeId?: string | null;
	message?: string;
}

/**
 * The `CONFLICT` error of `file.upload` only exposes the id of the trashed
 * document inside its message: it is extracted from there to offer the
 * restore action. To be replaced by structured data on the API side.
 */
const CONFLICT_DOCUMENT_ID = /\(document ([^,)]+),/;

const STATUS_LABELS: Record<UploadItemStatus, string> = {
	queued: "Queued",
	asking: "Waiting for a choice",
	uploading: "Uploading…",
	processing: "Processing…",
	done: "Added",
	duplicate: "Duplicate",
	trashed: "In the trash",
	expanded: "Expanded",
	skipped: "Skipped",
	error: "Failed",
};

let sequence = 0;
function nextKey(): string {
	sequence += 1;
	return `row-${sequence}`;
}

export interface UploadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Files to send straight away, typically coming from a drop on the page. */
	initialFiles?: File[];
}

/**
 * Batch tracker: picking or dropping files uploads them immediately, and every
 * row follows its file from `queued` to `done`.
 *
 * There is no "Upload" button and no batch-wide type select any more. The type
 * is chosen per row once the analysis is over: that is the only moment the
 * detected type is known, and confirming it is a one-click gesture.
 */
export function UploadDialog({
	open,
	onOpenChange,
	initialFiles,
}: UploadDialogProps) {
	const queryClient = useQueryClient();
	const forceRetry = useForceRetry();
	const inputId = useId();
	const dossierId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [items, setItems] = useState<UploadItem[]>([]);
	const [dragging, setDragging] = useState(false);
	const [running, setRunning] = useState(false);
	/** Mode chosen for the ZIPs of this batch; asked once, then remembered. */
	const [archiveMode, setArchiveMode] = useState<ArchiveMode | null>(null);
	const [groupInDossier, setGroupInDossier] = useState(false);
	const [dossierName, setDossierName] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

	const restore = useMutation(orpc.document.restore.mutationOptions());
	const settings = useQuery(orpc.settings.get.queryOptions({ input: {} }));
	const defaultMode = settings.data?.["intake.archives"] ?? "extract";

	/**
	 * Everything the loop needs to read while it runs, without waiting for a
	 * re-render: React state would still hold the values of the tick the loop
	 * started on.
	 */
	const queue = useRef<UploadItem[]>([]);
	const mode = useRef<ArchiveMode | null>(null);
	const busy = useRef(false);

	const patch = (key: string, next: Partial<UploadItem>) => {
		const apply = (list: UploadItem[]) =>
			list.map((item) => (item.key === key ? { ...item, ...next } : item));
		queue.current = apply(queue.current);
		setItems(apply(queue.current));
	};

	const push = (rows: UploadItem[]) => {
		queue.current = [...queue.current, ...rows];
		setItems(queue.current);
	};

	/** Inserts the children of an archive right below its row. */
	const insertAfter = (key: string, rows: UploadItem[]) => {
		const index = queue.current.findIndex((item) => item.key === key);
		const at = index < 0 ? queue.current.length : index + 1;
		queue.current = [
			...queue.current.slice(0, at),
			...rows,
			...queue.current.slice(at),
		];
		setItems(queue.current);
	};

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.document.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.review.key() }),
		]);
	};

	/** Waits until the pipeline stops reporting `processing` on a document. */
	const waitForProcessing = async (
		documentId: string,
	): Promise<string | null> => {
		const deadline = Date.now() + POLL_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const detail = await client.document.get({ id: documentId });
			if (detail.status !== "processing") {
				return detail.documentType?.id ?? null;
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		}
		return null;
	};

	/** Sends one file and turns the answer into rows. */
	const uploadOne = async (item: UploadItem): Promise<void> => {
		const file = item.file;
		if (!file) return;
		patch(item.key, { status: "uploading" });
		try {
			const result = await client.file.upload({
				files: [file],
				...(mode.current ? { archives: mode.current } : {}),
			});

			const archive = result.archives[0];
			if (archive) {
				await trackArchive(item, archive);
				return;
			}

			const created = result.created[0];
			const duplicate = result.duplicates[0];
			if (created) {
				patch(item.key, {
					status: "processing",
					documentId: created.documentId,
				});
				// The pipeline runs asynchronously: the row stays on "Processing"
				// until the document leaves that status, and only then does it know
				// which type was detected.
				const detected = await waitForProcessing(created.documentId);
				patch(item.key, { status: "done", documentTypeId: detected });
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
	};

	/** Expands an archive answer into one child row per entry. */
	const trackArchive = async (
		item: UploadItem,
		archive: ArchiveResult,
	): Promise<void> => {
		patch(item.key, {
			archive: true,
			// `extract` keeps no document for the container itself: its row then
			// stands for the expansion, not for a file of the library, and it is
			// not one of the entries the summary reports as skipped.
			status: archive.archiveDocumentId ? "done" : "expanded",
			documentId: archive.archiveDocumentId ?? undefined,
			message: `${ARCHIVE_MODE_LABELS[archive.mode].toLowerCase()} · ${countLabel(
				archive.extracted.length + archive.duplicates.length,
				"entry",
				"entries",
			)}`,
		});

		const children: UploadItem[] = [
			...archive.extracted.map((entry) => ({
				key: nextKey(),
				name: entry.entry,
				parentKey: item.key,
				status: "processing" as const,
				documentId: entry.documentId,
			})),
			...archive.duplicates.map((entry) => ({
				key: nextKey(),
				name: entry.entry,
				parentKey: item.key,
				status: (entry.trashed ? "trashed" : "duplicate") as UploadItemStatus,
				documentId: entry.duplicateOf || undefined,
			})),
			...archive.skipped.map((entry) => ({
				key: nextKey(),
				name: entry.entry,
				parentKey: item.key,
				status: "skipped" as const,
				message: entry.message,
			})),
		];
		insertAfter(item.key, children);

		for (const child of children) {
			if (child.status !== "processing" || !child.documentId) continue;
			const detected = await waitForProcessing(child.documentId);
			patch(child.key, { status: "done", documentTypeId: detected });
		}

		if (groupInDossier && archive.extracted.length > 0) {
			await groupArchive(item.name, archive);
		}
	};

	/** "Group into a dossier": one dossier holding everything the ZIP carried. */
	const groupArchive = async (
		filename: string,
		archive: ArchiveResult,
	): Promise<void> => {
		const name = dossierName.trim() || filename.replace(/\.zip$/i, "");
		try {
			const dossier = await client.dossier.create({ name });
			const documentIds = [
				...(archive.archiveDocumentId ? [archive.archiveDocumentId] : []),
				...archive.extracted.map((entry) => entry.documentId),
			];
			await client.dossier.addDocuments({ id: dossier.id, documentIds });
			setNotice(
				`Dossier "${dossier.name}" created with ${countLabel(documentIds.length, "document")}.`,
			);
			await queryClient.invalidateQueries({ queryKey: orpc.dossier.key() });
		} catch (error) {
			toastApiError(error, "The dossier could not be created.");
		}
	};

	/**
	 * Drains the queue, one file at a time.
	 *
	 * Sequential on purpose: the server caps a batch at twenty files, and a row
	 * that reports its own progress is worth more here than raw throughput.
	 */
	const drain = async (): Promise<void> => {
		if (busy.current) return;
		busy.current = true;
		setRunning(true);
		try {
			for (;;) {
				const next = queue.current.find(
					(item) => item.status === "queued" || item.status === "asking",
				);
				if (!next) break;
				// A ZIP needs a decision before anything is sent; the loop stops
				// here and starts again when the user has picked a mode.
				if (next.file && isArchiveFile(next.file) && !mode.current) {
					patch(next.key, { status: "asking" });
					return;
				}
				await uploadOne(next);
			}
		} finally {
			busy.current = false;
			setRunning(false);
			await invalidate();
		}
	};

	const addFiles = (files: FileList | File[]) => {
		const rows = Array.from(files).map((file) => ({
			key: nextKey(),
			name: file.name,
			size: file.size,
			file,
			status: "queued" as const,
		}));
		if (rows.length === 0) return;
		const zip = rows.find((row) => row.file && isArchiveFile(row.file));
		if (zip && !dossierName) {
			setDossierName(zip.name.replace(/\.zip$/i, ""));
		}
		push(rows);
		void drain();
	};

	// A drop on the page opens the dialog with its files: they start straight
	// away, exactly as if they had been dropped inside it. The identity of
	// `initialFiles` is the trigger — the provider hands a fresh array on every
	// drop, so dropping the same file twice still queues it twice.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `addFiles` is rebuilt on every render; adding it would replay the drop on each one.
	useEffect(() => {
		if (!open || !initialFiles || initialFiles.length === 0) return;
		addFiles(initialFiles);
	}, [open, initialFiles]);

	const chooseMode = (chosen: ArchiveMode) => {
		setArchiveMode(chosen);
		mode.current = chosen;
		void drain();
	};

	const onRestore = async (item: UploadItem) => {
		if (!item.documentId) return;
		try {
			await restore.mutateAsync({ id: item.documentId });
			patch(item.key, { status: "duplicate", message: undefined });
			toast.success("Document restored from the trash.");
		} catch (error) {
			toastApiError(error, "The document could not be restored.");
		}
	};

	/** Applies a type to one row, offering to force it when it is disabled. */
	const applyType = async (
		documentIds: string[],
		documentTypeId: string,
	): Promise<boolean> => {
		try {
			const applied = await forceRetry("type", (force) =>
				client.documentType.apply({ documentTypeId, documentIds, force }),
			);
			if (applied === null) return false;
			await invalidate();
			return true;
		} catch (error) {
			toastApiError(error, "The document type could not be applied.");
			return false;
		}
	};

	const setRowType = async (
		item: UploadItem,
		documentTypeId: string | null,
	) => {
		if (!item.documentId || !documentTypeId) return;
		if (await applyType([item.documentId], documentTypeId)) {
			patch(item.key, { documentTypeId });
		}
	};

	/** Single close entry point: the batch always starts over from scratch. */
	const changeOpen = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			queue.current = [];
			mode.current = null;
			setItems([]);
			setArchiveMode(null);
			setGroupInDossier(false);
			setDossierName("");
			setNotice(null);
		}
	};

	const onDrop = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(false);
		if (event.dataTransfer.files.length > 0) {
			addFiles(event.dataTransfer.files);
		}
	};

	const asking = items.find((item) => item.status === "asking");
	const added = items.filter((item) => item.status === "done").length;
	const duplicates = items.filter(
		(item) => item.status === "duplicate" || item.status === "trashed",
	).length;
	const failed = items.filter((item) => item.status === "error").length;
	const skipped = items.filter((item) => item.status === "skipped").length;
	const expanded = items.filter((item) => item.status === "expanded").length;
	const settled = added + duplicates + failed + skipped + expanded;

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
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Add documents</DialogTitle>
					<DialogDescription>
						PDF, PNG, JPEG, WebP, TIFF or a ZIP archive. Files start uploading
						as soon as you drop them.
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

						{asking ? (
							<ArchiveChoice
								filename={asking.name}
								defaultMode={defaultMode}
								onChoose={chooseMode}
								grouped={groupInDossier}
								onGroupedChange={setGroupInDossier}
								dossierName={dossierName}
								onDossierNameChange={setDossierName}
								fieldId={dossierId}
							/>
						) : null}

						<div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
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
									onRestore={() => onRestore(item)}
									onTypeChange={(next) => void setRowType(item, next)}
									onOpen={() => changeOpen(false)}
								/>
							))}
						</div>
					</>
				)}

				{settled > 0 || notice || archiveMode ? (
					<div className="flex flex-wrap items-center gap-1.5 text-xs">
						{archiveMode ? (
							<Badge tone="neutral">
								Archives: {ARCHIVE_MODE_LABELS[archiveMode]}
							</Badge>
						) : null}
						{added > 0 ? (
							<Badge tone="success">
								{countLabel(added, "document")} added
							</Badge>
						) : null}
						{duplicates > 0 ? (
							<Badge tone="info">{countLabel(duplicates, "duplicate")}</Badge>
						) : null}
						{skipped > 0 ? (
							<Badge tone="neutral">{skipped} skipped</Badge>
						) : null}
						{failed > 0 ? (
							<Badge tone="danger">{countLabel(failed, "failure")}</Badge>
						) : null}
						{notice ? (
							<span className="text-muted-foreground">{notice}</span>
						) : null}
					</div>
				) : null}

				<DialogFooter>
					<Button
						variant={running ? "outline" : "default"}
						onClick={() => changeOpen(false)}
					>
						{running ? <LoaderIcon className="animate-spin" /> : null}
						{running ? "Close" : "Done"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The pause a ZIP causes: three modes, prefilled from `intake.archives`, and
 * the optional dossier that gathers what comes out of it. The answer holds for
 * every archive of the batch.
 */
function ArchiveChoice({
	filename,
	defaultMode,
	onChoose,
	grouped,
	onGroupedChange,
	dossierName,
	onDossierNameChange,
	fieldId,
}: {
	filename: string;
	defaultMode: ArchiveMode;
	onChoose: (mode: ArchiveMode) => void;
	grouped: boolean;
	onGroupedChange: (grouped: boolean) => void;
	dossierName: string;
	onDossierNameChange: (name: string) => void;
	fieldId: string;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3 ring-1 ring-border">
			<div className="flex items-center gap-2">
				<FileArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
				<p className="min-w-0 flex-1 truncate font-medium text-sm">
					{filename}
				</p>
			</div>
			<p className="text-muted-foreground text-xs">
				What should happen to this archive? The answer applies to every archive
				of this batch.
			</p>
			<div className="flex flex-wrap gap-2">
				{ARCHIVE_MODES.map((mode) => (
					<Button
						key={mode}
						size="sm"
						variant={mode === defaultMode ? "default" : "outline"}
						title={ARCHIVE_MODE_HINTS[mode]}
						onClick={() => onChoose(mode)}
					>
						{ARCHIVE_MODE_LABELS[mode]}
					</Button>
				))}
			</div>
			<label
				className="flex items-center gap-2 text-sm"
				htmlFor={`${fieldId}-group`}
			>
				<Checkbox
					id={`${fieldId}-group`}
					checked={grouped}
					onCheckedChange={(checked) => onGroupedChange(checked === true)}
				/>
				Group into a dossier
			</label>
			{grouped ? (
				<Input
					aria-label="Dossier name"
					value={dossierName}
					onChange={(event) => onDossierNameChange(event.target.value)}
					placeholder="Dossier name"
				/>
			) : null}
		</div>
	);
}

function UploadRow({
	item,
	onRestore,
	onTypeChange,
	onOpen,
}: {
	item: UploadItem;
	onRestore: () => void;
	onTypeChange: (documentTypeId: string | null) => void;
	onOpen: () => void;
}) {
	const busy = item.status === "uploading" || item.status === "processing";
	const detail = [
		item.size === undefined ? null : formatFileSize(item.size),
		STATUS_LABELS[item.status],
		item.message,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div
			className={cn(
				"row-in flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2 ring-1 ring-border",
				// An entry of an archive is indented under the row it came from.
				item.parentKey && "ml-6",
			)}
		>
			<div className="flex items-center gap-3">
				<StatusIcon item={item} />
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">{item.name}</p>
					<p className="truncate font-mono text-muted-foreground text-xs tabular-nums">
						{detail}
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
			</div>

			{/* The detected type, confirmable or changeable without leaving here. */}
			{item.status === "done" && item.documentId && !item.archive ? (
				<DocumentTypePicker
					className="w-full"
					value={item.documentTypeId ?? null}
					onValueChange={onTypeChange}
					allowCreate={false}
					label={`Document type of ${item.name}`}
					placeholder="No type"
				/>
			) : null}

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

function StatusIcon({ item }: { item: UploadItem }) {
	const { status } = item;
	if (status === "uploading" || status === "processing") {
		return <LoaderIcon className="size-4 shrink-0 animate-spin text-primary" />;
	}
	if (status === "done") {
		return item.archive ? (
			<FileArchiveIcon className="size-4 shrink-0 text-tone-success-foreground" />
		) : (
			<CheckCircle2Icon className="size-4 shrink-0 text-tone-success-foreground" />
		);
	}
	if (status === "duplicate") {
		return <CopyIcon className="size-4 shrink-0 text-tone-info-foreground" />;
	}
	if (status === "expanded") {
		return (
			<FileArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
		);
	}
	if (status === "skipped") {
		return (
			<MinusCircleIcon className="size-4 shrink-0 text-muted-foreground" />
		);
	}
	if (status === "error" || status === "trashed") {
		return (
			<TriangleAlertIcon className="size-4 shrink-0 text-tone-warning-foreground" />
		);
	}
	if (status === "asking") {
		return (
			<FileArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
		);
	}
	return <UploadCloudIcon className="size-4 shrink-0 text-muted-foreground" />;
}
