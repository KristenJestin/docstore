import { createId } from "@docstore/db/id";
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { documentRelation } from "@docstore/db/schema/relation";
import { documentTag } from "@docstore/db/schema/tag";
import type {
	ArchiveDuplicateEntry,
	ArchiveExtractedEntry,
	ArchiveMode,
	ArchiveResult,
	ArchiveSkippedEntry,
} from "@docstore/shared/archive";
import {
	ARCHIVE_EXTENSION,
	ARCHIVE_MIME,
	archiveEntryRef,
} from "@docstore/shared/archive";
import type { DocumentSource, DocumentStatus } from "@docstore/shared/document";
import type { IntakeDefaults, IntakeMeta } from "@docstore/shared/intake";
import { documentFileKey, sha256 } from "@docstore/storage";
import { and, eq, isNull } from "drizzle-orm";
import {
	archiveContent,
	entryBasename,
	expandArchive,
	readArchiveEntries,
	sniffArchive,
} from "./archive";
import type { IngestionContext } from "./context";
import { DuplicateOriginalError } from "./errors";
import {
	extensionForMime,
	readMagicBytes,
	resolveContentMime,
	titleFromFilename,
} from "./media";
import { getSetting } from "./settings";
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
	/**
	 * What to do with a ZIP, overriding `defaults.archives` and the
	 * `intake.archives` setting for this call only.
	 */
	archives?: ArchiveMode;
}

/** Role given to the Party imposed by a channel's default values. */
const DEFAULT_PARTY_ROLE = "issuer" as const;

/** Created document and file. */
export interface IntakeCreated {
	documentId: string;
	fileId: string;
	duplicateOf?: never;
	archive?: never;
}

/** The same content already exists: nothing has been created. */
export interface IntakeDuplicate {
	duplicateOf: string;
	documentId?: never;
	fileId?: never;
	archive?: never;
}

/** The file was a ZIP: what came out of it is reported entry by entry. */
export interface IntakeArchive {
	archive: ArchiveResult;
	documentId?: never;
	fileId?: never;
	duplicateOf?: never;
}

export type IntakeResult = IntakeCreated | IntakeDuplicate | IntakeArchive;

/** Handy discriminator for the caller. */
export function isDuplicate(result: IntakeResult): result is IntakeDuplicate {
	return typeof result.duplicateOf === "string";
}

/** Same, for the archive branch. */
export function isArchive(result: IntakeResult): result is IntakeArchive {
	return result.archive !== undefined;
}

/**
 * The one branch that produced a document of its own.
 *
 * Narrowing on `isDuplicate` alone is no longer enough now that a third
 * outcome exists: a caller that wants `documentId` asks for it directly.
 */
export function isCreated(result: IntakeResult): result is IntakeCreated {
	return typeof result.documentId === "string";
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

/** What `storeIntakeFile` needs beyond the caller's input. */
interface StoreOptions {
	/** Canonical type, already decided by the content. */
	mime: string;
	/** Storage extension matching that type. */
	extension: string;
	/** `processing` unless the file needs no pipeline at all. */
	status?: DocumentStatus;
	/** Pre-computed text; only an archive fills it at intake. */
	content?: string;
	/** `false` for a file the pipeline has nothing to do with. */
	process?: boolean;
}

/**
 * Hash, duplicate detection, write to storage, row creation and publication of
 * the `document.process` job: the part of the intake that is the same whatever
 * the file turns out to be.
 */
async function storeIntakeFile(
	ctx: IngestionContext,
	input: IntakeFileInput,
	options: StoreOptions,
): Promise<IntakeCreated | IntakeDuplicate> {
	const hash = await sha256(input.data);

	const existing = await findDuplicate(ctx, hash);
	if (existing) return { duplicateOf: existing };

	const documentId = createId("doc_");
	const fileId = createId("fil_");
	const storageKey = documentFileKey(documentId, fileId, options.extension);

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
				status: options.status ?? "processing",
				content: options.content ?? null,
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
				mime: options.mime,
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

	if (options.process !== false) {
		await ctx.queue?.publishDocumentProcess({ documentId, fileId });
	}
	// SPEC §5: `document.created` is sent right at intake, before any processing.
	await emitDocumentEvent(ctx, "document.created", documentId);

	return { documentId, fileId };
}

/**
 * SPEC §5 `intake` + `store` steps: hash, duplicate detection, write to
 * storage, row creation and then publication of the `document.process` job.
 *
 * A ZIP takes the archive branch instead (`docs/ingestion.md` "Archives") and
 * comes back as `{ archive }`.
 *
 * Throws `UnsupportedMediaError` if the type is not accepted,
 * `ArchiveError` if a ZIP cannot be expanded.
 */
export async function intakeFile(
	ctx: IngestionContext,
	input: IntakeFileInput,
): Promise<IntakeResult> {
	const head = await readMagicBytes(input.data);
	if (sniffArchive(head)) {
		return { archive: await intakeArchive(ctx, input) };
	}

	// The content decides, not the declared type nor the extension (SPEC §5):
	// a `.pdf` that holds anything else is refused here rather than blowing up
	// three steps later in the OCR.
	const mime = resolveContentMime(head, input.filename, input.mime);
	return storeIntakeFile(ctx, input, {
		mime,
		extension: extensionForMime(mime),
	});
}

/* ------------------------------------------------------------------ */
/* Archives                                                             */
/* ------------------------------------------------------------------ */

/**
 * What this call does with a ZIP: the explicit override first, then the
 * default values of the channel, then the household setting.
 */
export async function resolveArchiveMode(
	ctx: IngestionContext,
	input: Pick<IntakeFileInput, "archives" | "defaults">,
): Promise<ArchiveMode> {
	if (input.archives) return input.archives;
	if (input.defaults?.archives) return input.defaults.archives;
	return (await getSetting(ctx.db, "intake.archives")) as ArchiveMode;
}

/** Whole payload as bytes: expansion needs the file, not a stream of it. */
async function toBytes(data: Uint8Array | Blob): Promise<Uint8Array> {
	return data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
}

/**
 * Expands, keeps, or does both with a ZIP (SPEC §5).
 *
 * Every entry goes through the ordinary intake: same duplicate detection, same
 * pipeline, same channel and same default values, with `source_ref` pointing
 * at `<archive>!<entry>` so a document always says where it came from.
 */
export async function intakeArchive(
	ctx: IngestionContext,
	input: IntakeFileInput,
): Promise<ArchiveResult> {
	const mode = await resolveArchiveMode(ctx, input);
	const data = await toBytes(input.data);

	const extracted: ArchiveExtractedEntry[] = [];
	const duplicates: ArchiveDuplicateEntry[] = [];
	const skipped: ArchiveSkippedEntry[] = [];
	let archiveDocumentId: string | null = null;

	// The archive document is created first: `both` links every extracted
	// document to it as they come out, without a second pass.
	if (mode !== "extract") {
		archiveDocumentId = await keepArchive(ctx, input, data);
	}

	if (mode !== "keep") {
		const expanded = expandArchive(data);
		skipped.push(...expanded.skipped);

		for (const file of expanded.files) {
			const ref = archiveEntryRef(input.filename, file.entry);
			try {
				const outcome = await storeIntakeFile(
					ctx,
					{
						...input,
						data: file.data,
						filename: entryBasename(file.entry),
						mime: file.mime,
						// The title of the archive, if any, belongs to the archive.
						title: undefined,
						sourceRef: ref,
						intakeMeta: {
							...(input.intakeMeta ?? {}),
							archive: { name: input.filename, entry: file.entry },
						},
					},
					{ mime: file.mime, extension: extensionForMime(file.mime) },
				);
				if (isDuplicate(outcome)) {
					duplicates.push({
						entry: file.entry,
						duplicateOf: outcome.duplicateOf,
						trashed: false,
					});
					continue;
				}
				extracted.push({ entry: file.entry, documentId: outcome.documentId });
				if (archiveDocumentId) {
					await relateToArchive(ctx, archiveDocumentId, outcome.documentId);
				}
			} catch (error) {
				// Content already stored on a trashed document: still a duplicate,
				// and one bad entry never fails the whole archive.
				if (error instanceof DuplicateOriginalError) {
					duplicates.push({
						entry: file.entry,
						duplicateOf: error.documentId ?? "",
						trashed: true,
					});
					continue;
				}
				throw error;
			}
		}
	}

	return {
		filename: input.filename,
		mode,
		extracted,
		duplicates,
		skipped,
		archiveDocumentId,
	};
}

/**
 * Stores the ZIP itself as one document.
 *
 * No OCR and no thumbnail — there is nothing to render — so the document skips
 * the pipeline and is `active` straight away. Its `content` is the list of the
 * paths it holds, which is what puts it in the full-text index: searching a
 * file name finds the archive carrying it.
 */
async function keepArchive(
	ctx: IngestionContext,
	input: IntakeFileInput,
	data: Uint8Array,
): Promise<string | null> {
	const outcome = await storeIntakeFile(
		ctx,
		{ ...input, data },
		{
			mime: ARCHIVE_MIME,
			extension: ARCHIVE_EXTENSION,
			status: "active",
			content: archiveContent(readArchiveEntries(data)),
			process: false,
		},
	);
	return isDuplicate(outcome) ? outcome.duplicateOf : outcome.documentId;
}

/** `related_to` from the archive to a document pulled out of it. */
async function relateToArchive(
	ctx: IngestionContext,
	archiveDocumentId: string,
	documentId: string,
): Promise<void> {
	await ctx.db
		.insert(documentRelation)
		.values({
			fromDocumentId: archiveDocumentId,
			toDocumentId: documentId,
			kind: "related_to",
		})
		.onConflictDoNothing();
}
