import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { documentType } from "@docstore/db/schema/document-type";
import { PDF_POINTS_DPI } from "@docstore/ocr";
import type { AsnSource, OcrLayout } from "@docstore/shared/document";
import type { AsnAutoAssignMode } from "@docstore/shared/settings";
import { asnAutoAssignSchema } from "@docstore/shared/settings";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AsnAllocationError } from "./errors";
import { getSetting } from "./settings";
import { primaryFile } from "./subject";

/**
 * Archive serial numbers (SPEC §2).
 *
 * Numbering is the bridge between the library and the paper binder: number 42
 * on the screen is the sheet filed under 42 in the drawer. Hence the two rules
 * every path here obeys — a number is never handed out twice, and a number
 * already given is never changed.
 *
 * `allocateAsn` is the single writer (the manual "Assign next" of the API goes
 * through it too); `maybeAutoAssignAsn` is the single decision point for the
 * automatic paths (end of the pipeline, application of a document type).
 */

/** Number of attempts before giving up on a concurrent ASN assignment. */
export const ASN_ATTEMPTS = 5;

/** Detects a Postgres unique constraint violation (`23505`). */
function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const candidate = error as { code?: unknown; cause?: { code?: unknown } };
	return candidate.code === "23505" || candidate.cause?.code === "23505";
}

/**
 * Hands the next free number to a document, atomically.
 *
 * The number is computed by the database itself (`max(asn) + 1` inside the
 * `update`), so two concurrent calls cannot read the same maximum. The unique
 * index is the final arbiter: on a collision the update is simply replayed.
 *
 * Returns the number written, or `null` when the document already carried one
 * (the update matches nothing): callers never have to check first.
 */
export async function allocateAsn(
	db: Db,
	documentId: string,
	source: AsnSource,
): Promise<number | null> {
	for (let attempt = 0; attempt < ASN_ATTEMPTS; attempt += 1) {
		try {
			const rows = await db
				.update(document)
				.set({
					asn: sql`(select coalesce(max(${document.asn}), 0) + 1 from ${document})`,
					asnSource: source,
				})
				.where(and(eq(document.id, documentId), isNull(document.asn)))
				.returning({ asn: document.asn });
			return rows[0]?.asn ?? null;
		} catch (error) {
			if (!isUniqueViolation(error)) throw error;
		}
	}

	throw new AsnAllocationError(documentId);
}

/**
 * `true` when the text of the document had to be recognised rather than read.
 *
 * The extraction step does not keep `OcrResult.source`, but the layout it
 * stored says it plainly: a PDF text layer is expressed in points
 * (`PDF_POINTS_DPI`) and every word carries a confidence of 100, while
 * Tesseract reports the resolution of the rendered page and a real confidence
 * per word. An image original never has a text layer at all, whichever channel
 * it came through (upload, watched folder or mailbox).
 */
export async function isScannedDocument(
	db: Db,
	documentId: string,
): Promise<boolean> {
	const file = await primaryFile(db, documentId);
	if (!file) return false;
	if (file.mime.startsWith("image/")) return true;
	return file.ocrLayout ? layoutIsOcr(file.ocrLayout) : false;
}

/** See {@link isScannedDocument}: the shape of a Tesseract layout. */
function layoutIsOcr(layout: OcrLayout): boolean {
	return layout.pages.some(
		(page) =>
			(page.dpi !== undefined && page.dpi !== PDF_POINTS_DPI) ||
			page.words.some((word) => word.conf !== 100),
	);
}

/** What `maybeAutoAssignAsn` needs; the ingestion context satisfies it. */
export interface AsnContext {
	db: Db;
}

/**
 * Numbers a document if the household asked for it, and does nothing at all
 * otherwise. Returns the number written, or `null`.
 *
 * Two independent reasons combine with an `or`: the `asn.autoAssign` setting
 * (`always`, or `scans` for a document that went through OCR) and a document
 * type flagged `paperOriginal`. Whichever applied, the outcome is the same
 * number, so nothing records which one won.
 *
 * A document in the trash or given up on by the pipeline is left alone: a
 * number spent on it would be a hole in the binder. One that already carries a
 * number is left alone too — that is the point of numbering.
 */
export async function maybeAutoAssignAsn(
	ctx: AsnContext,
	documentId: string,
): Promise<number | null> {
	const db = ctx.db;
	const rows = await db
		.select({
			asn: document.asn,
			status: document.status,
			deletedAt: document.deletedAt,
			paperOriginal: documentType.paperOriginal,
		})
		.from(document)
		.leftJoin(documentType, eq(documentType.id, document.documentTypeId))
		.where(eq(document.id, documentId))
		.limit(1);

	const row = rows[0];
	if (!row) return null;
	if (row.asn !== null) return null;
	if (row.deletedAt !== null || row.status === "failed") return null;

	if (!(await shouldAutoAssign(db, documentId, row.paperOriginal ?? false))) {
		return null;
	}
	return allocateAsn(db, documentId, "auto");
}

async function shouldAutoAssign(
	db: Db,
	documentId: string,
	paperOriginal: boolean,
): Promise<boolean> {
	if (paperOriginal) return true;
	const mode = await asnAutoAssignMode(db);
	if (mode === "always") return true;
	if (mode === "never") return false;
	return isScannedDocument(db, documentId);
}

/** Value of `asn.autoAssign`, falling back on its default. */
export async function asnAutoAssignMode(db: Db): Promise<AsnAutoAssignMode> {
	return asnAutoAssignSchema.parse(await getSetting(db, "asn.autoAssign"));
}
