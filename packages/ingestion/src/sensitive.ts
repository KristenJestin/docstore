import type { Db } from "@docstore/db";
import { document, documentFile } from "@docstore/db/schema/document";
import { documentDossier } from "@docstore/db/schema/dossier";
import { shareLink } from "@docstore/db/schema/share";
import type { StorageDriver } from "@docstore/storage";
import { StorageNotFoundError } from "@docstore/storage";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { IngestionContext } from "./context";

/**
 * Encryption at rest driven by the `sensitive` flag (SPEC §2, §8 iteration 7).
 *
 * Contract: `document.sensitive = true` ⇒ every file of the document (original,
 * archive, attachment **and** thumbnail) sits in `ctx.secureStorage`, with
 * `document_file.encrypted = true`. Setting the flag back to `false` puts them
 * back in the clear.
 *
 * Re-keying happens in place: the storage key does not change, only the bytes
 * behind it. `FsStorageDriver.put` writes to a temporary file then renames, so
 * the swap is atomic and nothing needs deleting afterwards — which also means a
 * failure halfway through leaves every object readable, each one consistent
 * with its own `encrypted` flag.
 */

export interface SetSensitiveResult {
	documentId: string;
	sensitive: boolean;
	/** Number of `document_file` rows whose storage was re-keyed. */
	rekeyed: number;
}

/**
 * Revokes every still-active share link that would expose a document which has
 * just become sensitive — the link on the document itself, and the links on the
 * dossiers holding it (SPEC §2: a sensitive document never leaves through a
 * public URL).
 *
 * `share_link.create` already refuses a sensitive target; this closes the other
 * direction, where a link was minted first and the flag came later.
 *
 * Returns the number of links revoked.
 */
export async function revokeShareLinksForSensitive(
	db: Db,
	documentId: string,
): Promise<number> {
	const dossiers = await db
		.select({ dossierId: documentDossier.dossierId })
		.from(documentDossier)
		.where(eq(documentDossier.documentId, documentId));
	const dossierIds = dossiers.map((row) => row.dossierId);

	const target = or(
		eq(shareLink.documentId, documentId),
		dossierIds.length > 0
			? inArray(shareLink.dossierId, dossierIds)
			: sql`false`,
	);

	const revoked = await db
		.update(shareLink)
		.set({ revokedAt: new Date(), revokedReason: "sensitive" })
		.where(and(isNull(shareLink.revokedAt), target))
		.returning({ id: shareLink.id });

	return revoked.length;
}

/**
 * Revokes every still-active link on a dossier that has just gained a sensitive
 * document.
 *
 * The mirror image of {@link revokeShareLinksForSensitive}: there the document
 * became sensitive under an existing link, here an already sensitive document
 * walks into a dossier a link is open on. Both directions have to close, or a
 * public URL keeps listing a document the store promised never to expose.
 *
 * Returns the number of links revoked.
 */
export async function revokeDossierShareLinksForSensitive(
	db: Db,
	dossierId: string,
): Promise<number> {
	const revoked = await db
		.update(shareLink)
		.set({ revokedAt: new Date(), revokedReason: "sensitive" })
		.where(and(isNull(shareLink.revokedAt), eq(shareLink.dossierId, dossierId)))
		.returning({ id: shareLink.id });

	return revoked.length;
}

/** The link points at a document that is flagged sensitive. */
const documentIsSensitive = sql`exists (
	select 1 from ${document}
	where ${document.id} = ${shareLink.documentId}
		and ${document.sensitive} = true
)`;

/**
 * The link points at a dossier holding at least one sensitive document that is
 * still in the store — a trashed one is already filtered out of `shareItems`,
 * and would close a window the user can legitimately reopen by emptying the
 * trash.
 */
const dossierHoldsSensitive = sql`exists (
	select 1 from ${documentDossier}
	inner join ${document} on ${document.id} = ${documentDossier.documentId}
	where ${documentDossier.dossierId} = ${shareLink.dossierId}
		and ${document.sensitive} = true
		and ${document.deletedAt} is null
)`;

/**
 * Closes every still-active public window onto sensitive content, wherever it
 * came from.
 *
 * {@link revokeShareLinksForSensitive} and
 * {@link revokeDossierShareLinksForSensitive} run on the two events that can
 * open such a window, and `share_link.create` refuses to open one — but each of
 * those guards was added after the fact, and a future one could be missed the
 * same way. This is the net underneath: run at every startup (and once as the
 * `0019_revoke-sensitive-share-links` migration), it makes the drift last at
 * most until the next restart instead of forever.
 *
 * Idempotent: a link already revoked keeps its own `revoked_at` and reason.
 * Returns the number of links this pass closed.
 */
export async function sweepSensitiveShareLinks(db: Db): Promise<number> {
	const revoked = await db
		.update(shareLink)
		.set({ revokedAt: new Date(), revokedReason: "sensitive" })
		.where(
			and(
				isNull(shareLink.revokedAt),
				or(documentIsSensitive, dossierHoldsSensitive),
			),
		)
		.returning({ id: shareLink.id });

	return revoked.length;
}

/** Moves one object from `from` to `to`, keeping the same storage key. */
async function rekeyObject(
	from: StorageDriver,
	to: StorageDriver,
	key: string,
): Promise<boolean> {
	let blob: Blob;
	try {
		blob = await from.get(key);
	} catch (error) {
		// A missing object (thumbnail not rendered yet, manual cleanup) must not
		// block the flag: there is simply nothing to re-key.
		if (error instanceof StorageNotFoundError) return false;
		throw error;
	}
	await to.put(key, new Uint8Array(await blob.arrayBuffer()));
	return true;
}

/**
 * Applies the `sensitive` flag to a document and brings its files in line.
 *
 * Idempotent, and safe to call when the flag has not changed: only the files
 * whose `encrypted` column disagrees with the target are rewritten. That is
 * what lets intake (`defaults.sensitive`) and the `set_sensitive` rule action
 * write in the clear first, then re-key once.
 *
 * When the context carries no master key (`encryptionEnabled === false`), the
 * flag is still persisted but the files stay in the clear: `encrypted` then
 * keeps saying the truth about what is on disk.
 */
export async function setSensitive(
	ctx: IngestionContext,
	documentId: string,
	sensitive: boolean,
): Promise<SetSensitiveResult> {
	const target = sensitive && ctx.encryptionEnabled;

	const files = await ctx.db
		.select({
			id: documentFile.id,
			storageKey: documentFile.storageKey,
			thumbnailKey: documentFile.thumbnailKey,
			encrypted: documentFile.encrypted,
		})
		.from(documentFile)
		.where(eq(documentFile.documentId, documentId));

	let rekeyed = 0;
	for (const file of files) {
		if (file.encrypted === target) continue;
		const from = file.encrypted ? ctx.secureStorage : ctx.storage;
		const to = target ? ctx.secureStorage : ctx.storage;
		await rekeyObject(from, to, file.storageKey);
		if (file.thumbnailKey) {
			await rekeyObject(from, to, file.thumbnailKey);
		}
		await ctx.db
			.update(documentFile)
			.set({ encrypted: target })
			.where(eq(documentFile.id, file.id));
		rekeyed += 1;
	}

	await ctx.db
		.update(document)
		.set({ sensitive })
		.where(eq(document.id, documentId));

	// Raising the flag closes every public window already open on the document.
	if (sensitive) {
		await revokeShareLinksForSensitive(ctx.db, documentId);
	}

	return { documentId, sensitive, rekeyed };
}

/**
 * Driver to read a file from, given its `encrypted` column.
 *
 * `EncryptedStorageDriver` passes non-encrypted objects through, but going
 * through the flag keeps the intent explicit and avoids a pointless header
 * check on the (many) plain files.
 */
export function storageForFile(
	ctx: IngestionContext,
	encrypted: boolean,
): StorageDriver {
	return encrypted ? ctx.secureStorage : ctx.storage;
}
