import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Document, DocumentFile } from "@docstore/db/schema/document";
import { document, documentFile } from "@docstore/db/schema/document";
import { DEFAULT_LANGUAGES, renderThumbnail } from "@docstore/ocr";
import type { DocumentStatus } from "@docstore/shared/document";
import { isBlockingReviewReason } from "@docstore/shared/document";
import { thumbnailKey } from "@docstore/storage";
import { and, eq } from "drizzle-orm";
import { analyzeDocument, computeReviewReasons } from "./analyze";
import { maybeAutoAssignAsn } from "./asn";
import type { IngestionContext } from "./context";
import { PipelineTargetNotFoundError } from "./errors";
import { type DocumentProcessPayload, JOB_RETRY_LIMIT } from "./jobs";
import { extensionForMimeOrUndefined, fileExtension } from "./media";
import { storageForFile } from "./sensitive";
import { emitDocumentEvent } from "./webhook";

/**
 * Steps of the pipeline (SPEC §5). Each one is idempotent: replaying it on an
 * already processed document recomputes the same result without side effects.
 */
export type PipelineStep = (
	ctx: IngestionContext,
	payload: DocumentProcessPayload,
) => Promise<void>;

/** Maximum length kept in `document.processing_error`. */
const MAX_ERROR_LENGTH = 4000;

async function loadFile(
	ctx: IngestionContext,
	{ documentId, fileId }: DocumentProcessPayload,
): Promise<DocumentFile> {
	const [row] = await ctx.db
		.select()
		.from(documentFile)
		.where(
			and(eq(documentFile.id, fileId), eq(documentFile.documentId, documentId)),
		)
		.limit(1);
	if (!row) throw new PipelineTargetNotFoundError(documentId, fileId);
	return row;
}

async function loadDocument(
	ctx: IngestionContext,
	{ documentId, fileId }: DocumentProcessPayload,
): Promise<Document> {
	const [row] = await ctx.db
		.select()
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	if (!row) throw new PipelineTargetNotFoundError(documentId, fileId);
	return row;
}

/**
 * Brings the file back from storage into a temporary file (the external
 * binaries work on paths) and cleans up afterwards.
 */
async function withLocalFile<T>(
	ctx: IngestionContext,
	file: DocumentFile,
	fn: (path: string) => Promise<T>,
): Promise<T> {
	await mkdir(ctx.tmpDir, { recursive: true });
	const workDir = await mkdtemp(join(ctx.tmpDir, "job-"));
	// The extension matters: the OCR providers use it as a fallback when the
	// mime is generic.
	const ext =
		extensionForMimeOrUndefined(file.mime) ||
		fileExtension(file.filename) ||
		"bin";
	const path = join(workDir, `${file.id}.${ext}`);
	try {
		// A sensitive document is stored encrypted: it goes back through the
		// matching driver before the external binaries can read it.
		const storage = storageForFile(ctx, file.encrypted);
		await Bun.write(path, await storage.get(file.storageKey));
		return await fn(path);
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}

/**
 * 1. `extractText` — PDF text layer or OCR, then persistence of the layout and
 * the text (SPEC §5, `extract_text` step).
 */
export const extractText: PipelineStep = async (ctx, payload) => {
	const file = await loadFile(ctx, payload);
	const result = await withLocalFile(ctx, file, (path) =>
		ctx.ocr.extract(
			{ path, mime: file.mime },
			{ languages: [...DEFAULT_LANGUAGES] },
		),
	);

	await ctx.db
		.update(documentFile)
		.set({
			ocrLayout: result.layout,
			pageCount: result.layout.pages.length,
		})
		.where(eq(documentFile.id, file.id));

	await ctx.db
		.update(document)
		.set({ content: result.text })
		.where(eq(document.id, file.documentId));
};

/** 3. `render` — PNG thumbnail stored at `thumbnails/<docId>/<fileId>.png`. */
export const render: PipelineStep = async (ctx, payload) => {
	const file = await loadFile(ctx, payload);
	const png = await withLocalFile(ctx, file, (path) =>
		renderThumbnail(ctx.tools, { path, mime: file.mime }),
	);

	const key = thumbnailKey(file.documentId, file.id);
	// The thumbnail of a sensitive document is a readable extract of it: it goes
	// to the same driver as the file itself.
	await storageForFile(ctx, file.encrypted).put(key, png);
	await ctx.db
		.update(documentFile)
		.set({ thumbnailKey: key })
		.where(eq(documentFile.id, file.id));
};

/**
 * 2. `analyze` — pre-pass (identifiers, dates, Party matching) then execution
 * of the `ingest` rules (SPEC §5, `analyze` and `rules` steps).
 */
export const analyze: PipelineStep = async (ctx, payload) => {
	await analyzeDocument(ctx.db, payload.documentId, {
		trigger: "ingest",
		ingestion: ctx,
	});
};

/**
 * Final status of a document (SPEC §4): `review` as soon as `analyze` has
 * raised a *blocking* review reason, `active` otherwise. Informational reasons
 * such as `recurringCandidate` are surfaced on the document but never queue it.
 *
 * Goes through `computeReviewReasons` so that a reason already satisfied by
 * the time `finalize` runs (e.g. a rule filled in the missing category) is
 * dropped rather than blindly trusted from `doc.reviewReasons`.
 */
export async function decideStatus(
	ctx: IngestionContext,
	doc: Document,
): Promise<DocumentStatus> {
	const reasons = await computeReviewReasons(ctx.db, doc.id);
	return reasons.some(isBlockingReviewReason) ? "review" : "active";
}

/** 4. `finalize` — leaving `processing` (SPEC §5, `finalize` step). */
export const finalize: PipelineStep = async (ctx, payload) => {
	const doc = await loadDocument(ctx, payload);
	const status = await decideStatus(ctx, doc);

	// The filter on `processing` makes the step replayable without overwriting a
	// status set meanwhile by a user.
	const updated = await ctx.db
		.update(document)
		.set({ status, processingError: null })
		.where(and(eq(document.id, doc.id), eq(document.status, "processing")))
		.returning({ id: document.id });

	// Numbering comes after the type has been applied (`analyze`) and after the
	// status is settled: `maybeAutoAssignAsn` needs both to decide, and it is a
	// no-op on a document that already carries a number, so replaying the
	// pipeline never spends a second one.
	await maybeAutoAssignAsn(ctx, doc.id);

	// The event is only sent if `finalize` really changed the status: replaying
	// the pipeline does not notify the subscribers again.
	if (updated.length > 0) {
		await emitDocumentEvent(
			ctx,
			status === "review" ? "document.review" : "document.processed",
			doc.id,
		);
	}
};

/** Steps run in order by the `document.process` job. */
export const PIPELINE_STEPS: ReadonlyArray<{
	name: string;
	run: PipelineStep;
}> = [
	{ name: "extractText", run: extractText },
	{ name: "analyze", run: analyze },
	{ name: "render", run: render },
	{ name: "finalize", run: finalize },
];

/** Logs the error on the document; never hides the original error. */
export async function recordProcessingError(
	ctx: IngestionContext,
	documentId: string,
	step: string,
	error: unknown,
): Promise<void> {
	const detail =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	const message = `[${step}] ${detail}`.slice(0, MAX_ERROR_LENGTH);
	try {
		await ctx.db
			.update(document)
			.set({ processingError: message })
			.where(eq(document.id, documentId));
	} catch (writeError) {
		console.error("[ingestion] unable to record processingError", writeError);
	}
}

/**
 * Marks a document `failed` (SPEC §5): the pipeline used up its retries and
 * nothing more will happen to it until `document.reprocess` is called.
 *
 * Filtered on `processing` like `finalize`, so a status the user set in the
 * meantime is never overwritten.
 */
export async function markProcessingFailed(
	ctx: IngestionContext,
	documentId: string,
): Promise<void> {
	try {
		await ctx.db
			.update(document)
			.set({ status: "failed" })
			.where(
				and(eq(document.id, documentId), eq(document.status, "processing")),
			);
	} catch (error) {
		console.error("[ingestion] unable to mark the document failed", error);
	}
}

export interface ProcessDocumentOptions {
	/** 1-based attempt number of the job (pg-boss counts retries from 0). */
	attempt?: number;
	/** Attempts after which the document is given up on. */
	maxAttempts?: number;
}

/**
 * Chains the steps for a file.
 *
 * On failure the error is logged on the document and rethrown so pg-boss
 * retries. After the **last** attempt the document leaves `processing` for
 * `failed`: staying in `processing` for ever made a broken document look like a
 * slow one, invisible in every list and impossible to act on.
 */
export async function processDocument(
	ctx: IngestionContext,
	payload: DocumentProcessPayload,
	options: ProcessDocumentOptions = {},
): Promise<void> {
	const attempt = options.attempt ?? 1;
	const maxAttempts = options.maxAttempts ?? JOB_RETRY_LIMIT + 1;

	for (const step of PIPELINE_STEPS) {
		try {
			await step.run(ctx, payload);
		} catch (error) {
			await recordProcessingError(ctx, payload.documentId, step.name, error);
			if (attempt >= maxAttempts) {
				await markProcessingFailed(ctx, payload.documentId);
			}
			throw error;
		}
	}
}
