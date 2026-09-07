import { createId } from "@docstore/db/id";
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { documentTag } from "@docstore/db/schema/tag";
import type { DocumentSource } from "@docstore/shared/document";
import type { IntakeDefaults, IntakeMeta } from "@docstore/shared/intake";
import { documentFileKey, sha256 } from "@docstore/storage";
import { and, eq, isNull } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { DuplicateOriginalError } from "./errors";
import {
	extensionForMime,
	readMagicBytes,
	resolveContentMime,
	titleFromFilename,
} from "./media";
import { emitDocumentEvent } from "./webhook";

export interface IntakeFileInput {
	data: Uint8Array | Blob;
	filename: string;
	mime: string;
	/** User owning the created document. */
	createdById: string;
	/** Explicit title; otherwise the file name without extension. */
	title?: string;
	/** Intake channel (SPEC §5); `upload` by default. */
	source?: DocumentSource;
	/** Id of the `intake_source` / `upload_link`, or the mail `Message-ID`. */
	sourceRef?: string | null;
	/** What the channel knows about the document (mail sender and subject…). */
	intakeMeta?: IntakeMeta | null;
	/** Actual reception date (`YYYY-MM-DD`), for dated channels. */
	receivedAt?: string | null;
	/** Category, tags, Issuer and sensitivity imposed by the channel. */
	defaults?: IntakeDefaults;
}

/** Role given to the Party imposed by a channel's default values. */
const DEFAULT_PARTY_ROLE = "issuer" as const;

/** Created document and file. */
export interface IntakeCreated {
	documentId: string;
	fileId: string;
	duplicateOf?: never;
}

/** The same content already exists: nothing has been created. */
export interface IntakeDuplicate {
	duplicateOf: string;
	documentId?: never;
	fileId?: never;
}

export type IntakeResult = IntakeCreated | IntakeDuplicate;

/** Handy discriminator for the caller. */
export function isDuplicate(result: IntakeResult): result is IntakeDuplicate {
	return typeof result.duplicateOf === "string";
}

function byteLength(data: Uint8Array | Blob): number {
	return data instanceof Blob ? data.size : data.byteLength;
}

/**
 * Looks for an identical original (same sha256) attached to a live document.
 * Documents in the trash do not block a new upload.
 */
async function findDuplicate(
	ctx: IngestionContext,
	hash: string,
): Promise<string | undefined> {
	const [row] = await ctx.db
		.select({ documentId: documentFile.documentId })
		.from(documentFile)
		.innerJoin(document, eq(document.id, documentFile.documentId))
		.where(
			and(
				eq(documentFile.sha256, hash),
				eq(documentFile.kind, "original"),
				isNull(document.deletedAt),
			),
		)
		.limit(1);
	return row?.documentId;
}

/** Name of the unique index set on the originals. */
const SHA256_UNIQUE_INDEX = "document_file_sha256_original_uidx";

/** Recognizes a sha256 uniqueness violation (drizzle wraps the pg error). */
function isSha256UniqueViolation(error: unknown): boolean {
	const candidates = [error, (error as { cause?: unknown })?.cause];
	return candidates.some((candidate) => {
		const pg = candidate as
			| { code?: string; constraint?: string }
			| undefined
			| null;
		return pg?.code === "23505" && pg?.constraint === SHA256_UNIQUE_INDEX;
	});
}

/** Document owning a sha256, trash included. */
async function findAnyOwner(
	ctx: IngestionContext,
	hash: string,
): Promise<string | undefined> {
	const [row] = await ctx.db
		.select({ documentId: documentFile.documentId })
		.from(documentFile)
		.where(
			and(eq(documentFile.sha256, hash), eq(documentFile.kind, "original")),
		)
		.limit(1);
	return row?.documentId;
}

/**
 * SPEC §5 `intake` + `store` steps: hash, duplicate detection, write to
 * storage, row creation and then publication of the `document.process` job.
 *
 * Throws `UnsupportedMediaError` if the type is not accepted.
 */
export async function intakeFile(
	ctx: IngestionContext,
	input: IntakeFileInput,
): Promise<IntakeResult> {
	// The content decides, not the declared type nor the extension (SPEC §5):
	// a `.pdf` that holds anything else is refused here rather than blowing up
	// three steps later in the OCR.
	const mime = resolveContentMime(
		await readMagicBytes(input.data),
		input.filename,
		input.mime,
	);
	const hash = await sha256(input.data);

	const existing = await findDuplicate(ctx, hash);
	if (existing) return { duplicateOf: existing };

	const documentId = createId("doc_");
	const fileId = createId("fil_");
	const storageKey = documentFileKey(
		documentId,
		fileId,
		extensionForMime(mime),
	);

	const defaults = input.defaults ?? {};
	// A channel that imposes `sensitive` writes straight through the encrypted
	// driver: the plaintext never touches the disk (SPEC §8 iteration 7). Rules
	// that raise the flag later go through `setSensitive`, which re-keys.
	const encrypted = Boolean(defaults.sensitive) && ctx.encryptionEnabled;

	// The content is written first: a row without its stored object would be far
	// more annoying than an orphan object (cleaned up if the insert fails).
	const { size } = await (encrypted ? ctx.secureStorage : ctx.storage).put(
		storageKey,
		input.data,
	);

	try {
		await ctx.db.transaction(async (tx) => {
			await tx.insert(document).values({
				id: documentId,
				title: input.title?.trim() || titleFromFilename(input.filename),
				status: "processing",
				createdById: input.createdById,
				source: input.source ?? "upload",
				sourceRef: input.sourceRef ?? null,
				intakeMeta: input.intakeMeta ?? null,
				receivedAt: input.receivedAt ?? null,
				categoryId: defaults.categoryId ?? null,
				sensitive: defaults.sensitive ?? false,
			});
			if (defaults.tagIds && defaults.tagIds.length > 0) {
				await tx
					.insert(documentTag)
					.values(
						defaults.tagIds.map((tagId) => ({
							documentId,
							tagId,
							source: "manual" as const,
							confidence: null,
						})),
					)
					.onConflictDoNothing();
			}
			if (defaults.partyId) {
				await tx
					.insert(documentParty)
					.values({
						documentId,
						partyId: defaults.partyId,
						role: DEFAULT_PARTY_ROLE,
						source: "manual",
						confidence: null,
					})
					.onConflictDoNothing();
			}
			await tx.insert(documentFile).values({
				id: fileId,
				documentId,
				kind: "original",
				filename: input.filename,
				mime,
				size: size || byteLength(input.data),
				sha256: hash,
				storageKey,
				encrypted,
			});
		});
	} catch (error) {
		await ctx.storage.delete(storageKey).catch(() => {});
		if (isSha256UniqueViolation(error)) {
			throw new DuplicateOriginalError(hash, await findAnyOwner(ctx, hash));
		}
		throw error;
	}

	await ctx.queue?.publishDocumentProcess({ documentId, fileId });
	// SPEC §5: `document.created` is sent right at intake, before any processing.
	await emitDocumentEvent(ctx, "document.created", documentId);

	return { documentId, fileId };
}
