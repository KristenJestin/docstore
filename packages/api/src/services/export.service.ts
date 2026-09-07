import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import {
	customField,
	documentFieldValue,
} from "@docstore/db/schema/custom-field";
import { document, documentFile } from "@docstore/db/schema/document";
import {
	renderTitleTemplate,
	TITLE_TEMPLATE_PLACEHOLDERS,
	unknownTemplatePlaceholders,
} from "@docstore/rules";
import type { ContentLocale } from "@docstore/shared/common";
import { formatContentDate, UI_LOCALE } from "@docstore/shared/common";
import type { DocumentListItem } from "@docstore/shared/document";
import type {
	ExportDocumentsInput,
	ExportPreview,
} from "@docstore/shared/export";
import { EXPORT_MAX_DOCUMENTS } from "@docstore/shared/export";
import type { StorageDriver } from "@docstore/storage";
import { ORPCError } from "@orpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { listDocuments } from "./document.service";
import { getContentLocale } from "./settings.service";

/**
 * Tree export (SPEC §8 iteration 7).
 *
 * The archive holds the **original** file of each selected document, renamed
 * with a title template and filed under the chosen layout. `metadata.json` and
 * `manifest.csv` describe the selection so the archive can be read back without
 * the application.
 *
 * The ZIP is produced as a stream (`fflate`): a 2 GB export never sits in
 * memory. Individual files are still read whole before being pushed, which is
 * bounded by the 20 MB per-document cap.
 */

/** What the export needs from storage, whichever driver holds the bytes. */
export interface ExportStorage {
	read(storageKey: string, encrypted: boolean): Promise<Blob>;
}

export interface ExportContext {
	db: Db;
	storage: ExportStorage;
}

/** Builds an `ExportStorage` from the two ingestion drivers. */
export function exportStorage(
	plain: StorageDriver,
	secure: StorageDriver,
): ExportStorage {
	return {
		read: (storageKey, encrypted) =>
			(encrypted ? secure : plain).get(storageKey),
	};
}

/* ------------------------------------------------------------------ */
/* Plan                                                                 */
/* ------------------------------------------------------------------ */

export interface ExportEntry {
	/** Path inside the archive, separators included. */
	path: string;
	documentId: string;
	fileId: string;
	storageKey: string;
	encrypted: boolean;
	size: number;
	sha256: string;
	mime: string;
	originalFilename: string;
	document: DocumentListItem;
}

export interface ExportPlan {
	entries: ExportEntry[];
	bytes: number;
	truncated: boolean;
}

/** Characters banned from a path segment on Windows and in a ZIP. */
const ILLEGAL_SEGMENT_CHARS = new Set([
	"/",
	":",
	"*",
	"?",
	'"',
	"<",
	">",
	"|",
	"\\",
]);

/** Safe, non-empty path segment, capped so the full path stays reasonable. */
export function sanitizeSegment(value: string, fallback: string): string {
	let filtered = "";
	for (const char of value) {
		// Path separators, reserved characters and control bytes become spaces.
		filtered +=
			char.charCodeAt(0) < 32 || ILLEGAL_SEGMENT_CHARS.has(char) ? " " : char;
	}
	const cleaned = filtered
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, 120)
		.trim();
	return cleaned.length > 0 ? cleaned : fallback;
}

/** Extension of the original file, dot included; empty when there is none. */
function extensionOf(filename: string): string {
	const index = filename.lastIndexOf(".");
	if (index <= 0 || index === filename.length - 1) return "";
	const ext = filename.slice(index + 1);
	return /^[A-Za-z0-9]{1,8}$/.test(ext) ? `.${ext.toLowerCase()}` : "";
}

/**
 * Original filename without its extension, so `{filename}` in a template does
 * not double up with the extension the export always appends afterwards
 * (`dedupe`, below).
 */
function stripExtension(filename: string, extension: string): string {
	return extension ? filename.slice(0, -extension.length) : filename;
}

function issuerOf(item: DocumentListItem): string | null {
	return item.parties.find((party) => party.role === "issuer")?.name ?? null;
}

/** Folder the document goes into, given the layout. */
export function layoutFolder(
	item: DocumentListItem,
	layout: ExportDocumentsInput["layout"],
): string {
	switch (layout) {
		case "by-year":
			return sanitizeSegment(item.documentDate?.slice(0, 4) ?? "", "undated");
		case "by-party":
			return sanitizeSegment(issuerOf(item) ?? "", "no-issuer");
		case "by-category":
			return sanitizeSegment(item.category?.name ?? "", "uncategorized");
		default:
			return "";
	}
}

/** ` (2)`, ` (3)`… on collision, before the extension. */
function dedupe(taken: Set<string>, path: string, extension: string): string {
	let candidate = `${path}${extension}`;
	let index = 2;
	while (taken.has(candidate.toLowerCase())) {
		candidate = `${path} (${index})${extension}`;
		index += 1;
	}
	taken.add(candidate.toLowerCase());
	return candidate;
}

/**
 * Refuses a template the renderer cannot fill: `{invoice}` would end up in the
 * file names as a literal `{invoice}`, on every document of the archive.
 */
export function assertKnownTemplate(template: string): void {
	const unknown = unknownTemplatePlaceholders(template);
	if (unknown.length === 0) return;
	throw new ORPCError("BAD_REQUEST", {
		message: `Unknown placeholder(s) in the template: ${unknown
			.map((name) => `{${name}}`)
			.join(", ")}. Allowed: ${TITLE_TEMPLATE_PLACEHOLDERS.map(
			(name) => `{${name}}`,
		).join(", ")}.`,
	});
}

/** Every document matching the filters, paged through to the cap. */
async function selectDocuments(
	db: Db,
	input: ExportDocumentsInput,
): Promise<{ items: DocumentListItem[]; truncated: boolean }> {
	const items: DocumentListItem[] = [];
	const pageSize = 100;
	let page = 1;
	let total = Number.POSITIVE_INFINITY;

	while (items.length < EXPORT_MAX_DOCUMENTS && items.length < total) {
		const result = await listDocuments(db, {
			...input.filters,
			// The `sensitive` filter is not a suggestion: without the explicit
			// opt-in, those documents never reach the archive.
			sensitive: input.includeSensitive ? input.filters.sensitive : false,
			page,
			pageSize,
		});
		total = result.total;
		items.push(...result.items);
		if (result.items.length === 0 || page >= result.totalPages) break;
		page += 1;
	}

	// A `failed` document has nothing usable to ship: it is only exported when
	// explicitly asked for by status.
	const kept =
		input.filters.status === "failed"
			? items
			: items.filter((item) => item.status !== "failed");

	return {
		items: kept.slice(0, EXPORT_MAX_DOCUMENTS),
		truncated: total > EXPORT_MAX_DOCUMENTS,
	};
}

/** Resolves paths and files without reading a single byte from storage. */
export async function buildExportPlan(
	db: Db,
	input: ExportDocumentsInput,
): Promise<ExportPlan> {
	assertKnownTemplate(input.template);
	// File names are content, not interface: `{period:MMMM yyyy}` reads
	// "janvier 2026" in a French archive.
	const locale = await getContentLocale(db);
	const { items, truncated } = await selectDocuments(db, input);
	if (items.length === 0) return { entries: [], bytes: 0, truncated };

	const files = await db
		.select({
			id: documentFile.id,
			documentId: documentFile.documentId,
			kind: documentFile.kind,
			filename: documentFile.filename,
			mime: documentFile.mime,
			size: documentFile.size,
			sha256: documentFile.sha256,
			storageKey: documentFile.storageKey,
			encrypted: documentFile.encrypted,
		})
		.from(documentFile)
		.where(
			inArray(
				documentFile.documentId,
				items.map((item) => item.id),
			),
		)
		.orderBy(asc(documentFile.createdAt), asc(documentFile.id));

	// One file per document: the original, otherwise the oldest one.
	const primary = new Map<string, (typeof files)[number]>();
	for (const file of files) {
		const current = primary.get(file.documentId);
		if (!current || (file.kind === "original" && current.kind !== "original")) {
			primary.set(file.documentId, file);
		}
	}

	// `{period}` is not part of `DocumentListItem`: read straight from the table
	// so a template can file an archive by period.
	const periodRows = await db
		.select({
			id: document.id,
			periodStart: document.periodStart,
			periodEnd: document.periodEnd,
		})
		.from(document)
		.where(
			inArray(
				document.id,
				items.map((item) => item.id),
			),
		);
	const periodById = new Map(periodRows.map((row) => [row.id, row]));

	const taken = new Set<string>();
	const entries: ExportEntry[] = [];
	let bytes = 0;

	for (const item of items) {
		const file = primary.get(item.id);
		// A document still being processed has no file yet: nothing to export.
		if (!file) continue;

		const extension = extensionOf(file.filename);
		const rendered = renderTitleTemplate(
			input.template,
			{
				date: item.documentDate,
				issuer: issuerOf(item),
				category: item.category?.name ?? null,
				title: item.title,
				// Without its extension: the export appends the real one once, below.
				filename: stripExtension(file.filename, extension),
				ext: extension ? extension.slice(1) : null,
				periodStart: periodById.get(item.id)?.periodStart ?? null,
				periodEnd: periodById.get(item.id)?.periodEnd ?? null,
			},
			locale,
		);
		const folder = layoutFolder(item, input.layout);
		const base = sanitizeSegment(rendered, item.id);
		const path = dedupe(taken, folder ? `${folder}/${base}` : base, extension);

		entries.push({
			path,
			documentId: item.id,
			fileId: file.id,
			storageKey: file.storageKey,
			encrypted: file.encrypted,
			size: file.size,
			sha256: file.sha256,
			mime: file.mime,
			originalFilename: file.filename,
			document: item,
		});
		bytes += file.size;
	}

	return { entries, bytes, truncated };
}

/** `export.preview`: what the archive would contain, without building it. */
export async function previewExport(
	db: Db,
	input: ExportDocumentsInput,
): Promise<ExportPreview> {
	const plan = await buildExportPlan(db, input);
	return {
		count: plan.entries.length,
		bytes: plan.bytes,
		sample: plan.entries.slice(0, 20).map((entry) => entry.path),
		truncated: plan.truncated,
	};
}

/* ------------------------------------------------------------------ */
/* Metadata                                                             */
/* ------------------------------------------------------------------ */

function csvCell(value: string | number | null): string {
	const text = value === null ? "" : String(value);
	return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * `manifest.csv` is the human half of the archive: it is opened in a
 * spreadsheet, so its dates are written in the content language.
 * `metadata.json` keeps the raw ISO dates for whoever reads the archive back.
 */
export function buildManifestCsv(
	entries: ExportEntry[],
	locale: ContentLocale = UI_LOCALE,
): string {
	const header = [
		"path",
		"documentId",
		"title",
		"documentDate",
		"issuer",
		"category",
		"tags",
		"bytes",
		"sha256",
	].join(",");
	const rows = entries.map((entry) =>
		[
			csvCell(entry.path),
			csvCell(entry.documentId),
			csvCell(entry.document.title),
			csvCell(
				entry.document.documentDate
					? formatContentDate(entry.document.documentDate, locale)
					: null,
			),
			csvCell(issuerOf(entry.document)),
			csvCell(entry.document.category?.name ?? null),
			csvCell(entry.document.tags.map((tag) => tag.name).join("; ")),
			csvCell(entry.size),
			csvCell(entry.sha256),
		].join(","),
	);
	return [header, ...rows].join("\n");
}

/** `metadata.json`: everything the archive alone could not tell. */
export async function buildMetadata(
	db: Db,
	entries: ExportEntry[],
	input: ExportDocumentsInput,
): Promise<unknown> {
	const documentIds = entries.map((entry) => entry.documentId);

	const fieldValues =
		documentIds.length > 0
			? await db
					.select({
						documentId: documentFieldValue.documentId,
						slug: customField.slug,
						name: customField.name,
						type: customField.type,
						value: documentFieldValue.value,
						source: documentFieldValue.source,
						confidence: documentFieldValue.confidence,
					})
					.from(documentFieldValue)
					.innerJoin(
						customField,
						eq(customField.id, documentFieldValue.fieldId),
					)
					.where(inArray(documentFieldValue.documentId, documentIds))
			: [];

	// Notes are not part of `DocumentListItem`: read straight from the table.
	const noteRows =
		documentIds.length > 0
			? await db
					.select({ id: document.id, notes: document.notes })
					.from(document)
					.where(inArray(document.id, documentIds))
			: [];
	const notesByDocument = new Map(noteRows.map((row) => [row.id, row.notes]));

	const valuesByDocument = new Map<string, typeof fieldValues>();
	for (const value of fieldValues) {
		const bucket = valuesByDocument.get(value.documentId);
		if (bucket) bucket.push(value);
		else valuesByDocument.set(value.documentId, [value]);
	}

	const categoryIds = [
		...new Set(
			entries
				.map((entry) => entry.document.category?.id)
				.filter((value): value is string => Boolean(value)),
		),
	];
	const categories =
		categoryIds.length > 0
			? await db
					.select({
						id: category.id,
						name: category.name,
						slug: category.slug,
						parentId: category.parentId,
					})
					.from(category)
					.where(inArray(category.id, categoryIds))
			: [];

	const tags = new Map<string, { id: string; name: string }>();
	const parties = new Map<string, { id: string; name: string; type: string }>();
	for (const entry of entries) {
		for (const tag of entry.document.tags) {
			tags.set(tag.id, { id: tag.id, name: tag.name });
		}
		for (const party of entry.document.parties) {
			parties.set(party.id, {
				id: party.id,
				name: party.name,
				type: party.type,
			});
		}
	}

	return {
		exportedAt: new Date().toISOString(),
		locale: await getContentLocale(db),
		template: input.template,
		layout: input.layout,
		includeSensitive: input.includeSensitive,
		count: entries.length,
		documents: entries.map((entry) => ({
			path: entry.path,
			id: entry.documentId,
			title: entry.document.title,
			status: entry.document.status,
			documentDate: entry.document.documentDate,
			datePrecision: entry.document.datePrecision,
			sensitive: entry.document.sensitive,
			notes: notesByDocument.get(entry.documentId) ?? null,
			categoryId: entry.document.category?.id ?? null,
			tagIds: entry.document.tags.map((tag) => tag.id),
			parties: entry.document.parties.map((party) => ({
				id: party.id,
				role: party.role,
			})),
			file: {
				id: entry.fileId,
				filename: entry.originalFilename,
				mime: entry.mime,
				bytes: entry.size,
				sha256: entry.sha256,
			},
			fieldValues: (valuesByDocument.get(entry.documentId) ?? []).map(
				(value) => ({
					slug: value.slug,
					name: value.name,
					type: value.type,
					value: value.value,
					source: value.source,
					confidence: value.confidence,
				}),
			),
		})),
		categories,
		tags: [...tags.values()],
		parties: [...parties.values()],
	};
}

/* ------------------------------------------------------------------ */
/* Archive                                                              */
/* ------------------------------------------------------------------ */

export interface ExportResult {
	stream: ReadableStream<Uint8Array>;
	/** Suggested name for `Content-Disposition`. */
	filename: string;
	count: number;
	bytes: number;
}

function archiveName(now: Date = new Date()): string {
	const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
	return `docstore-export-${stamp}.zip`;
}

/**
 * Builds the archive as a stream.
 *
 * Original files go in stored (`ZipPassThrough`): PDFs and JPEGs are already
 * compressed, deflating them again costs CPU for nothing. `metadata.json` and
 * `manifest.csv` are text, so they are deflated.
 */
export async function exportDocuments(
	ctx: ExportContext,
	input: ExportDocumentsInput,
): Promise<ExportResult> {
	const plan = await buildExportPlan(ctx.db, input);
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const zip = new Zip((error, chunk, final) => {
				if (closed) return;
				if (error) {
					closed = true;
					controller.error(error);
					return;
				}
				controller.enqueue(chunk);
				if (final) {
					closed = true;
					controller.close();
				}
			});

			void (async () => {
				try {
					for (const entry of plan.entries) {
						const file = new ZipPassThrough(entry.path);
						zip.add(file);
						const blob = await ctx.storage.read(
							entry.storageKey,
							entry.encrypted,
						);
						file.push(new Uint8Array(await blob.arrayBuffer()), true);
					}

					if (input.includeMetadata) {
						const metadata = new ZipDeflate("metadata.json", { level: 6 });
						zip.add(metadata);
						metadata.push(
							encoder.encode(
								JSON.stringify(
									await buildMetadata(ctx.db, plan.entries, input),
									null,
									2,
								),
							),
							true,
						);

						const manifest = new ZipDeflate("manifest.csv", { level: 6 });
						zip.add(manifest);
						manifest.push(
							encoder.encode(
								buildManifestCsv(plan.entries, await getContentLocale(ctx.db)),
							),
							true,
						);
					}

					zip.end();
				} catch (error) {
					if (!closed) {
						closed = true;
						controller.error(error);
					}
				}
			})();
		},
	});

	return {
		stream,
		filename: archiveName(),
		count: plan.entries.length,
		bytes: plan.bytes,
	};
}
