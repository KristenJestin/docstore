import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import { eq } from "drizzle-orm";

/**
 * Metadata a human entered by hand (`document.manual_fields`, SPEC §5).
 *
 * Everything the ingestion computes is recomputed on every pass: that is what
 * makes `document.reprocess` able to fix a date an older analyzer read wrong,
 * instead of freezing the first answer forever. The exception is what someone
 * typed — `document.update` records those field names, and the pipeline reads
 * them here before writing a date, a period, a validity or a title.
 */
export async function manualFieldsOf(
	db: Db,
	documentId: string,
): Promise<string[]> {
	const rows = await db
		.select({ manualFields: document.manualFields })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	return rows[0]?.manualFields ?? [];
}
