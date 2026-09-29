import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import {
	maskSensitiveContent,
	mayReadSensitive,
	type ScopedCaller,
} from "@docstore/shared/api-key";
import type { PartyIdentifiers } from "@docstore/shared/party";
import { maskParty } from "@docstore/shared/party-masking";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

/**
 * Guards on the content of sensitive documents (SPEC §6, issue #1).
 *
 * The decision itself is `mayReadSensitive` (`@docstore/shared/api-key`),
 * shared with MCP; these helpers only turn a refusal into the `FORBIDDEN` (403)
 * that oRPC and the `/files` routes answer. 403 rather than 404: the caller
 * already knows the id, and the metadata already says `sensitive: true`.
 */

export const SENSITIVE_SCOPE_REQUIRED =
	'This API key does not have the "sensitive" scope required for the content of a sensitive document.';

/** Throws `FORBIDDEN` when `sensitive` is true and the caller may not read it. */
export function assertSensitiveAccess(
	caller: ScopedCaller,
	sensitive: boolean,
): void {
	if (sensitive && !mayReadSensitive(caller)) {
		throw new ORPCError("FORBIDDEN", { message: SENSITIVE_SCOPE_REQUIRED });
	}
}

/**
 * Same check for a procedure that only has a document id (dry runs that read
 * the OCR layer). An unknown id passes: the procedure answers its own
 * `NOT_FOUND`. The lookup is skipped for a caller that may read everything.
 */
export async function assertDocumentSensitiveAccess(
	db: Db,
	caller: ScopedCaller,
	documentId: string,
): Promise<void> {
	if (mayReadSensitive(caller)) return;
	const [row] = await db
		.select({ sensitive: document.sensitive })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	assertSensitiveAccess(caller, row?.sensitive ?? false);
}

/**
 * Masks the OCR text of a sensitive document for an oRPC caller that may not
 * read it (`content` becomes the MCP placeholder, `masked: true`). Applied to
 * every procedure that returns a document, reads and writes alike.
 */
export function withMaskedContent<
	T extends { sensitive: boolean; content: string | null },
>(context: { apiKey?: ScopedCaller }, document: T): T & { masked: boolean } {
	return maskSensitiveContent(document, context.apiKey);
}

/**
 * Masks the personal identifiers and notes of a Party for an oRPC caller
 * without the `sensitive` scope (issue #23, `maskParty`). Applied to every
 * procedure that returns a Party, reads and writes alike.
 */
export function withMaskedParty<
	T extends {
		type: string;
		isHouseholdMember: boolean;
		identifiers: PartyIdentifiers;
		notes: string | null;
	},
>(context: { apiKey?: ScopedCaller }, party: T): T & { masked: boolean } {
	return maskParty(party, context.apiKey);
}
