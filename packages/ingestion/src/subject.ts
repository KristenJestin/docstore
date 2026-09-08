import type { Db } from "@docstore/db";
import { category } from "@docstore/db/schema/category";
import type { Document, DocumentFile } from "@docstore/db/schema/document";
import {
	document,
	documentFile,
	documentParty,
} from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import { documentTag } from "@docstore/db/schema/tag";
import type { DetectedIdentifier, RuleSubject } from "@docstore/rules";
import {
	detectDates,
	detectIdentifiers,
	detectPeriods,
	STRONG_IDENTIFIER_CONFIDENCE,
	WEAK_IDENTIFIER_CONFIDENCE,
} from "@docstore/rules";
import type { OcrLayout } from "@docstore/shared/document";
import { normalizeIdentifier } from "@docstore/shared/party";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

/**
 * Building of the `RuleSubject` (SPEC §5, `analyze` step).
 *
 * This is the only place that talks to the database for the rule engine:
 * everything `@docstore/rules` needs is gathered here then passed by value.
 */

/** Identifiers whose match is worth a "strong" proposal. */
const STRONG_KINDS = new Set(["siren", "siret", "vat", "iban"]);
/** `party.identifiers` keys stored as scalars (the others are arrays). */
const SCALAR_KINDS = new Set(["siren", "siret", "vat"]);

export interface IdentifierMatch {
	identifier: DetectedIdentifier;
	partyId: string;
	partyName: string;
	confidence: number;
	/**
	 * `true` for a member of the household. Their name and their IBAN are all
	 * over the documents they *receive*: they are the subject, never the issuer
	 * (SPEC §2).
	 */
	isHouseholdMember: boolean;
}

export interface DocumentSubject {
	subject: RuleSubject;
	document: Document;
	/** Reference file (the original when present). */
	file: DocumentFile | null;
	identifierMatches: IdentifierMatch[];
}

/** Slugs from the root down to the category (maximum depth: 3). */
export async function categorySlugPath(
	db: Db,
	categoryId: string | null,
): Promise<{ path: string[]; name: string | null }> {
	if (!categoryId) return { path: [], name: null };

	const path: string[] = [];
	let name: string | null = null;
	let current: string | null = categoryId;

	for (let depth = 0; depth < 10 && current; depth++) {
		const rows: { slug: string; name: string; parentId: string | null }[] =
			await db
				.select({
					slug: category.slug,
					name: category.name,
					parentId: category.parentId,
				})
				.from(category)
				.where(eq(category.id, current))
				.limit(1);
		const row = rows[0];
		if (!row) break;
		if (depth === 0) name = row.name;
		path.unshift(row.slug);
		current = row.parentId;
	}

	return { path, name };
}

/**
 * A category and all its ancestors, the category itself included.
 *
 * Used wherever a rule "applies to a category": a custom field offered on
 * `Invoice` stays offered on `Invoice / Subscription`.
 */
export async function categoryChainIds(
	db: Db,
	categoryId: string | null,
): Promise<string[]> {
	const chain: string[] = [];
	let current: string | null = categoryId;

	// Depth is capped at 3 by the schema; the guard covers a cycle introduced by
	// hand in the database.
	for (let depth = 0; depth < 10 && current; depth++) {
		if (chain.includes(current)) break;
		chain.push(current);
		const rows: { parentId: string | null }[] = await db
			.select({ parentId: category.parentId })
			.from(category)
			.where(eq(category.id, current))
			.limit(1);
		const row = rows[0];
		if (!row) break;
		current = row.parentId;
	}
	return chain;
}

/** Reference file of the document: the original, otherwise the oldest. */
export async function primaryFile(
	db: Db,
	documentId: string,
	fileId?: string,
): Promise<DocumentFile | null> {
	const rows = await db
		.select()
		.from(documentFile)
		.where(
			fileId
				? and(
						eq(documentFile.documentId, documentId),
						eq(documentFile.id, fileId),
					)
				: eq(documentFile.documentId, documentId),
		)
		.orderBy(asc(documentFile.createdAt), asc(documentFile.id));

	return rows.find((row) => row.kind === "original") ?? rows[0] ?? null;
}

/** Matches the detected identifiers against the existing `party.identifiers`. */
export async function matchIdentifiers(
	db: Db,
	identifiers: DetectedIdentifier[],
): Promise<IdentifierMatch[]> {
	if (identifiers.length === 0) return [];

	// Detection already produces canonical values; going through the shared
	// helper keeps the two sides of the comparison provably identical.
	const needles = new Map(
		identifiers.map((identifier) => [
			identifier,
			normalizeIdentifier(identifier.kind, identifier.value),
		]),
	);

	const conditions: SQL[] = identifiers.map((identifier) =>
		SCALAR_KINDS.has(identifier.kind)
			? sql`${party.identifiers} ->> ${identifier.kind}::text = ${needles.get(identifier)}`
			: sql`${party.identifiers} -> ${identifier.kind}::text ? ${needles.get(identifier)}::text`,
	);

	const rows = await db
		.select({
			id: party.id,
			name: party.name,
			identifiers: party.identifiers,
			isHouseholdMember: party.isHouseholdMember,
		})
		.from(party)
		.where(or(...conditions))
		.orderBy(asc(party.name), asc(party.id));

	const matches: IdentifierMatch[] = [];
	for (const identifier of identifiers) {
		const needle = needles.get(identifier);
		for (const row of rows) {
			const stored = row.identifiers as Record<string, unknown>;
			const value = stored[identifier.kind];
			const normalized = (item: unknown) =>
				typeof item === "string"
					? normalizeIdentifier(identifier.kind, item)
					: null;
			const found = Array.isArray(value)
				? value.some((item) => normalized(item) === needle)
				: normalized(value) === needle;
			if (!found) continue;
			matches.push({
				identifier: { ...identifier, partyId: row.id },
				partyId: row.id,
				partyName: row.name,
				confidence: STRONG_KINDS.has(identifier.kind)
					? STRONG_IDENTIFIER_CONFIDENCE
					: WEAK_IDENTIFIER_CONFIDENCE,
				isHouseholdMember: row.isHouseholdMember,
			});
		}
	}

	// Strong proposals first: `analyze` keeps the first one.
	return matches.sort((a, b) => b.confidence - a.confidence);
}

/** Assembles the subject evaluated by the rules for a given document. */
export async function buildSubject(
	db: Db,
	documentId: string,
): Promise<DocumentSubject | null> {
	const documents = await db
		.select()
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const row = documents[0];
	if (!row) return null;

	const file = await primaryFile(db, documentId);
	const content = row.content ?? "";

	const [parties, tags, categoryInfo] = await Promise.all([
		db
			.select({
				partyId: documentParty.partyId,
				role: documentParty.role,
				name: party.name,
			})
			.from(documentParty)
			.innerJoin(party, eq(party.id, documentParty.partyId))
			.where(eq(documentParty.documentId, documentId))
			.orderBy(asc(party.name)),
		db
			.select({ tagId: documentTag.tagId })
			.from(documentTag)
			.where(eq(documentTag.documentId, documentId)),
		categorySlugPath(db, row.categoryId),
	]);

	const identifiers = detectIdentifiers(content);
	const identifierMatches = await matchIdentifiers(db, identifiers);
	const matchedById = new Map(
		identifierMatches.map((match) => [
			`${match.identifier.kind}:${match.identifier.value}`,
			match.partyId,
		]),
	);

	const subject: RuleSubject = {
		content,
		filename: file?.filename ?? "",
		mime: file?.mime ?? "",
		pageCount: file?.pageCount ?? null,
		source: row.source,
		// Filled in by the mail channel (`document.intake_meta`): this is what
		// makes the `mail.from` and `mail.subject` conditions usable.
		...(row.intakeMeta?.mail ? { mail: row.intakeMeta.mail } : {}),
		detectedIdentifiers: identifiers.map((identifier) => {
			const partyId = matchedById.get(`${identifier.kind}:${identifier.value}`);
			return partyId ? { ...identifier, partyId } : identifier;
		}),
		parties: parties.map((item) => ({
			partyId: item.partyId,
			role: item.role,
			name: item.name,
		})),
		categoryId: row.categoryId,
		categorySlugPath: categoryInfo.path,
		categoryName: categoryInfo.name,
		tags: tags.map((item) => item.tagId),
		documentDate: row.documentDate,
		title: row.title,
		periodStart: row.periodStart,
		periodEnd: row.periodEnd,
		detectedDates: detectDates(content),
		detectedPeriods: detectPeriods(content),
	};

	return { subject, document: row, file, identifierMatches };
}

export interface DocumentExtractionInput {
	text: string;
	layout: OcrLayout | null;
	fileId: string | null;
	pageCount: number | null;
}

/** Text and OCR layer of a document, input of the extraction rules. */
export async function loadExtractionInput(
	db: Db,
	documentId: string,
	fileId?: string,
): Promise<DocumentExtractionInput | null> {
	const documents = await db
		.select({ content: document.content })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	const row = documents[0];
	if (!row) return null;

	const file = await primaryFile(db, documentId, fileId);
	return {
		text: row.content ?? "",
		layout: file?.ocrLayout ?? null,
		fileId: file?.id ?? null,
		pageCount: file?.pageCount ?? null,
	};
}

/** A document with the same normalized title and date (likely duplicate). */
export interface TitleDateDuplicate {
	id: string;
	title: string;
}

/** Documents with the same normalized title and date (likely duplicate). */
export async function findTitleDateDuplicate(
	db: Db,
	documentId: string,
): Promise<TitleDateDuplicate | null> {
	const rows = await db.execute<{ id: string; title: string }>(sql`
		select other.id, other.title
		from ${document} as current
		inner join ${document} as other
			on other.id <> current.id
			and other.document_date = current.document_date
			and lower(btrim(regexp_replace(other.title, '\\s+', ' ', 'g')))
				= lower(btrim(regexp_replace(current.title, '\\s+', ' ', 'g')))
		where current.id = ${documentId}
			and current.document_date is not null
			and current.deleted_at is null
			and other.deleted_at is null
		order by other.created_at, other.id
		limit 1
	`);
	return rows.rows[0] ?? null;
}

/** Names of the linked Parties, used by the Review queue messages. */
export async function partyNames(
	db: Db,
	partyIds: string[],
): Promise<Map<string, string>> {
	if (partyIds.length === 0) return new Map();
	const rows = await db
		.select({ id: party.id, name: party.name })
		.from(party)
		.where(inArray(party.id, partyIds));
	return new Map(rows.map((row) => [row.id, row.name]));
}
