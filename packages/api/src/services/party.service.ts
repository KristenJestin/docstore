import type { Db } from "@docstore/db";
import { documentParty } from "@docstore/db/schema/document";
import { party, partyRelation } from "@docstore/db/schema/party";
import type { Paginated } from "@docstore/shared/pagination";
import { paginationMeta } from "@docstore/shared/pagination";
import type {
	CreatePartyInput,
	CreatePartyRelationInput,
	ListPartiesInput,
	MergePartiesInput,
	MergePartiesResult,
	Party,
	PartyDetail,
	PartyDuplicate,
	PartyIdentifierKind,
	PartyIdentifiers,
	PartyRelation,
	PartyRelationWithParty,
	UpdatePartyInput,
} from "@docstore/shared/party";
import {
	mergeIdentifiers,
	normalizeIdentifier,
	normalizeIdentifiers,
	PARTY_IDENTIFIER_FIELDS,
	SCALAR_PARTY_IDENTIFIER_KINDS,
} from "@docstore/shared/party";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import {
	and,
	asc,
	count,
	countDistinct,
	eq,
	inArray,
	isNull,
	ne,
	or,
	sql,
} from "drizzle-orm";
import { likePattern } from "./sql-utils";

/** Columns exposed for a "summary" Party (links, relations). */
const partySummaryColumns = {
	id: party.id,
	name: party.name,
	type: party.type,
	logoKey: party.logoKey,
};

/**
 * Case-insensitive search on the name, the aliases (`text[]` array) and the
 * JSONB identifiers (scalars + `email` / `domain` / `iban` arrays).
 */
function partySearchCondition(query: string): SQL {
	const pattern = likePattern(query);
	// Identifiers are stored canonical: "812 345 678" only ever matches the
	// stored "812345678" through its own normalized form.
	const idPattern = likePattern(normalizeIdentifier("siren", query));
	const arrayMatch = (key: string, needle: string = pattern) => sql`exists (
		select 1
		from jsonb_array_elements_text(
			coalesce(${party.identifiers} -> ${key}::text, '[]'::jsonb)
		) as identifier_value
		where identifier_value ilike ${needle}
	)`;

	return sql`(
		${party.name} ilike ${pattern}
		or exists (
			select 1 from unnest(${party.aliases}) as alias where alias ilike ${pattern}
		)
		or ${party.identifiers} ->> 'siren' ilike ${idPattern}
		or ${party.identifiers} ->> 'siret' ilike ${idPattern}
		or ${party.identifiers} ->> 'vat' ilike ${idPattern}
		or ${party.identifiers} ->> 'customerRef' ilike ${pattern}
		or ${arrayMatch("email")}
		or ${arrayMatch("domain")}
		or ${arrayMatch("iban", idPattern)}
	)`;
}

export async function listParties(
	db: Db,
	input: ListPartiesInput,
): Promise<Paginated<Party>> {
	const conditions: SQL[] = [];
	if (!input.includeArchived) {
		conditions.push(isNull(party.archivedAt));
	}
	if (input.type) {
		conditions.push(eq(party.type, input.type));
	}
	if (input.query) {
		conditions.push(partySearchCondition(input.query));
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const totalRows = await db
		.select({ value: count() })
		.from(party)
		.where(where);
	const total = totalRows[0]?.value ?? 0;

	const items = await db
		.select()
		.from(party)
		.where(where)
		.orderBy(asc(party.name), asc(party.id))
		.limit(input.pageSize)
		.offset((input.page - 1) * input.pageSize);

	return {
		items,
		...paginationMeta(total, input.page, input.pageSize),
	};
}

async function requireParty(db: Db, id: string): Promise<Party> {
	const rows = await db.select().from(party).where(eq(party.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${id}" not found.`,
		});
	}
	return row;
}

async function loadRelations(
	db: Db,
	id: string,
	direction: "from" | "to",
): Promise<PartyRelationWithParty[]> {
	const [own, other] =
		direction === "from"
			? [partyRelation.fromPartyId, partyRelation.toPartyId]
			: [partyRelation.toPartyId, partyRelation.fromPartyId];

	const rows = await db
		.select({ relation: partyRelation, otherParty: partySummaryColumns })
		.from(partyRelation)
		.innerJoin(party, eq(party.id, other))
		.where(eq(own, id))
		.orderBy(asc(party.name));

	return rows.map((row) => ({ ...row.relation, otherParty: row.otherParty }));
}

export async function getParty(db: Db, id: string): Promise<PartyDetail> {
	const row = await requireParty(db, id);
	const [relationsFrom, relationsTo, documentCountRows] = await Promise.all([
		loadRelations(db, id, "from"),
		loadRelations(db, id, "to"),
		db
			.select({ value: countDistinct(documentParty.documentId) })
			.from(documentParty)
			.where(eq(documentParty.partyId, id)),
	]);

	return {
		...row,
		relationsFrom,
		relationsTo,
		documentCount: documentCountRows[0]?.value ?? 0,
	};
}

/**
 * Rejects "obvious" duplicates: same legal identifier (SIREN/SIRET/VAT), same
 * web domain, or same (type, name) pair ignoring case.
 *
 * A domain identifies an issuer as reliably as a SIRET does in practice — it is
 * what the logo fetch and the mail intake match on — so two live Parties can no
 * more share one than they can share a SIRET.
 *
 * Archived Parties are out of the way by definition and never trigger the
 * conflict: that is what makes an archived Party re-creatable, and what lets
 * {@link mergeParties} leave the absorbed one behind without poisoning every
 * later edit of the survivor.
 */
async function assertNoDuplicate(
	db: Db,
	values: {
		type?: Party["type"];
		name?: string;
		identifiers?: PartyIdentifiers;
	},
	excludeId?: string,
): Promise<void> {
	const conditions: SQL[] = [];

	for (const key of SCALAR_PARTY_IDENTIFIER_KINDS) {
		const value = values.identifiers?.[key];
		if (value) {
			conditions.push(sql`${party.identifiers} ->> ${key}::text = ${value}`);
		}
	}
	for (const domain of values.identifiers?.domain ?? []) {
		conditions.push(sql`${party.identifiers} -> 'domain' ? ${domain}::text`);
	}
	if (values.type && values.name) {
		conditions.push(
			and(
				eq(party.type, values.type),
				sql`lower(${party.name}) = lower(${values.name})`,
			) as SQL,
		);
	}
	if (conditions.length === 0) {
		return;
	}

	const scoped = and(or(...conditions), isNull(party.archivedAt)) as SQL;
	const where = excludeId ? and(scoped, ne(party.id, excludeId)) : scoped;

	const rows = await db
		.select({ id: party.id, name: party.name })
		.from(party)
		.where(where)
		.limit(1);
	const existing = rows[0];
	if (existing) {
		throw new ORPCError("CONFLICT", {
			message: `An equivalent Party already exists: "${existing.name}" (${existing.id}).`,
		});
	}
}

export async function createParty(
	db: Db,
	input: CreatePartyInput,
): Promise<Party> {
	// Household members are Parties of type `person` (SPEC §2): the shared
	// `createPartyInput` refine already rejects this over the API, but MCP calls
	// this service directly with its own input shape, so the guard is repeated
	// here too (same as `updateParty`).
	if (input.isHouseholdMember && input.type !== "person") {
		throw new ORPCError("BAD_REQUEST", {
			message: 'A household member must be of type "person".',
		});
	}

	// Stored canonical: the check that rejects a duplicate must compare the same
	// value a later lookup will search for.
	const identifiers = normalizeIdentifiers(input.identifiers);
	await assertNoDuplicate(db, { ...input, identifiers });

	const rows = await db
		.insert(party)
		.values({
			type: input.type,
			name: input.name,
			aliases: input.aliases,
			logoKey: input.logoKey ?? null,
			identifiers,
			isHouseholdMember: input.isHouseholdMember,
			userId: input.userId ?? null,
			notes: input.notes ?? null,
		})
		.returning();

	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The Party could not be created.",
		});
	}
	return row;
}

export async function updateParty(
	db: Db,
	id: string,
	input: UpdatePartyInput,
): Promise<Party> {
	const current = await requireParty(db, id);

	const type = input.type ?? current.type;
	// Household members are Parties of type `person` (SPEC §2): changing the
	// type would leave the household holding a company.
	const householdMember = input.isHouseholdMember ?? current.isHouseholdMember;
	if (householdMember && type !== "person") {
		throw new ORPCError("BAD_REQUEST", {
			message:
				'A household member must stay of type "person": clear `isHouseholdMember` first.',
		});
	}

	// Patch semantics by default: `{ siret }` used to wipe the emails and the
	// domains stored beside it. `replaceIdentifiers` opts back into the whole
	// object being authoritative, for a form that owns the entire block.
	const identifiers =
		input.identifiers === undefined
			? undefined
			: normalizeIdentifiers(
					mergeIdentifiers(
						input.replaceIdentifiers ? {} : current.identifiers,
						input.identifiers,
					),
				);

	await assertNoDuplicate(
		db,
		{ type, name: input.name ?? current.name, identifiers },
		id,
	);

	const patch: Partial<typeof party.$inferInsert> = {};
	if (input.type !== undefined) patch.type = input.type;
	if (input.name !== undefined) patch.name = input.name;
	if (input.aliases !== undefined) patch.aliases = input.aliases;
	if (input.logoKey !== undefined) patch.logoKey = input.logoKey ?? null;
	if (identifiers !== undefined) patch.identifiers = identifiers;
	if (input.isHouseholdMember !== undefined) {
		patch.isHouseholdMember = input.isHouseholdMember;
	}
	if (input.userId !== undefined) patch.userId = input.userId ?? null;
	if (input.notes !== undefined) patch.notes = input.notes ?? null;
	if (input.archivedAt !== undefined) {
		patch.archivedAt = input.archivedAt ? new Date(input.archivedAt) : null;
	}

	if (Object.keys(patch).length === 0) {
		return current;
	}

	const rows = await db
		.update(party)
		.set(patch)
		.where(eq(party.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${id}" not found.`,
		});
	}
	return row;
}

/**
 * Absorbs `sourceId` into `targetId`, then archives the source.
 *
 * The same company reaches the store twice often enough — once from a SIRET on
 * an invoice, once from a name typed into a form — and deleting the second one
 * is refused as soon as a document points at it. Merging is the way out:
 * documents, relations, identifiers and the source name (kept as an alias) move
 * to the survivor, and the source is archived rather than deleted so the
 * history of what happened stays readable.
 *
 * The source keeps no identifier of its own: an identifier names exactly one
 * Party, and leaving a copy behind would make `party.findByIdentifier` answer
 * with a Party nobody uses any more.
 */
export async function mergeParties(
	db: Db,
	input: MergePartiesInput,
): Promise<MergePartiesResult> {
	if (input.sourceId === input.targetId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "A Party cannot be merged into itself.",
		});
	}
	const source = await requireParty(db, input.sourceId);
	const target = await requireParty(db, input.targetId);

	const counts = await db.transaction(async (tx) => {
		// A document already linked to the target under the same role would break
		// the (document, party, role) primary key: the source link is dropped, the
		// target one already says everything.
		await tx.execute(sql`
			delete from ${documentParty} as source_link
			where source_link.party_id = ${source.id}
				and exists (
					select 1 from ${documentParty} as target_link
					where target_link.document_id = source_link.document_id
						and target_link.party_id = ${target.id}
						and target_link.role = source_link.role
				)
		`);
		const movedDocuments = await tx
			.update(documentParty)
			.set({ partyId: target.id })
			.where(eq(documentParty.partyId, source.id))
			.returning({ documentId: documentParty.documentId });

		const movedFrom = await tx
			.update(partyRelation)
			.set({ fromPartyId: target.id })
			.where(eq(partyRelation.fromPartyId, source.id))
			.returning({ id: partyRelation.id });
		const movedTo = await tx
			.update(partyRelation)
			.set({ toPartyId: target.id })
			.where(eq(partyRelation.toPartyId, source.id))
			.returning({ id: partyRelation.id });
		// A relation that had both ends on the two merged Parties now points at
		// itself, which means nothing.
		await tx
			.delete(partyRelation)
			.where(eq(partyRelation.fromPartyId, partyRelation.toPartyId));

		// Union: the target keeps what it already had, the source fills the gaps.
		const identifiers = normalizeIdentifiers(
			mergeIdentifierUnion(target.identifiers, source.identifiers),
		);
		// The absorbed name stays reachable by search, without duplicating one the
		// target already carries.
		const aliases = [
			...new Set([...target.aliases, ...source.aliases, source.name]),
		].filter((alias) => alias !== target.name);

		await tx
			.update(party)
			.set({ identifiers, aliases })
			.where(eq(party.id, target.id));
		await tx
			.update(party)
			.set({ identifiers: {}, archivedAt: source.archivedAt ?? new Date() })
			.where(eq(party.id, source.id));

		return {
			movedDocuments: new Set(movedDocuments.map((row) => row.documentId)).size,
			movedRelations: movedFrom.length + movedTo.length,
		};
	});

	return {
		target: await getParty(db, target.id),
		archivedId: source.id,
		...counts,
	};
}

/**
 * Union of two identifier objects: scalars from the target win, arrays are
 * concatenated without duplicates.
 */
function mergeIdentifierUnion(
	target: PartyIdentifiers,
	source: PartyIdentifiers,
): PartyIdentifiers {
	const result: Record<string, unknown> = { ...target };
	for (const key of PARTY_IDENTIFIER_FIELDS) {
		const own = target[key];
		const other = source[key];
		if (other === undefined) continue;
		if (Array.isArray(other)) {
			const merged = [...(Array.isArray(own) ? own : []), ...other];
			result[key] = [...new Set(merged)];
		} else if (own === undefined) {
			result[key] = other;
		}
	}
	return result as PartyIdentifiers;
}

/**
 * Pairs of live Parties that look like the same one: they share a web domain,
 * or their names only differ by case and whitespace.
 *
 * Reported rather than merged: only a human knows whether "Orange" the operator
 * and "Orange" the bank are one company. The pair is ordered oldest first, which
 * is the `targetId` a merge should keep.
 */
export async function listPartyDuplicates(db: Db): Promise<PartyDuplicate[]> {
	const rows = await db.execute<{
		party_id: string;
		party_name: string;
		party_logo_key: string | null;
		other_party_id: string;
		other_party_name: string;
		other_party_logo_key: string | null;
		reason: PartyDuplicate["reason"];
		value: string;
	}>(sql`
		with live as (
			select ${party.id} as id, ${party.name} as name, ${party.logoKey} as logo_key,
				${party.identifiers} as identifiers, ${party.createdAt} as created_at
			from ${party}
			where ${party.archivedAt} is null
		),
		by_domain as (
			select distinct
				first.id as party_id, first.name as party_name, first.logo_key as party_logo_key,
				second.id as other_party_id, second.name as other_party_name,
				second.logo_key as other_party_logo_key,
				'sameDomain'::text as reason, first_domain.value as value
			from live as first
			cross join lateral jsonb_array_elements_text(
				coalesce(first.identifiers -> 'domain', '[]'::jsonb)
			) as first_domain(value)
			join live as second
				on (first.created_at, first.id) < (second.created_at, second.id)
			cross join lateral jsonb_array_elements_text(
				coalesce(second.identifiers -> 'domain', '[]'::jsonb)
			) as second_domain(value)
			where first_domain.value = second_domain.value
		),
		by_name as (
			select
				first.id as party_id, first.name as party_name, first.logo_key as party_logo_key,
				second.id as other_party_id, second.name as other_party_name,
				second.logo_key as other_party_logo_key,
				'sameName'::text as reason,
				lower(btrim(regexp_replace(first.name, '\\s+', ' ', 'g'))) as value
			from live as first
			join live as second
				on (first.created_at, first.id) < (second.created_at, second.id)
				and lower(btrim(regexp_replace(first.name, '\\s+', ' ', 'g')))
					= lower(btrim(regexp_replace(second.name, '\\s+', ' ', 'g')))
		)
		select * from by_domain
		union all
		select * from by_name
		order by reason, value, party_id, other_party_id
	`);

	const ids = [
		...new Set(rows.rows.flatMap((row) => [row.party_id, row.other_party_id])),
	];
	const counts = await documentCounts(db, ids);

	// A pair caught by both rules is reported once, on the stronger signal.
	const seen = new Set<string>();
	const duplicates: PartyDuplicate[] = [];
	for (const row of rows.rows) {
		const key = `${row.party_id}:${row.other_party_id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		duplicates.push({
			partyId: row.party_id,
			partyName: row.party_name,
			partyLogoKey: row.party_logo_key,
			partyDocumentCount: counts.get(row.party_id) ?? 0,
			otherPartyId: row.other_party_id,
			otherPartyName: row.other_party_name,
			otherPartyLogoKey: row.other_party_logo_key,
			otherPartyDocumentCount: counts.get(row.other_party_id) ?? 0,
			reason: row.reason,
			value: row.value,
		});
	}
	return duplicates;
}

/** Number of distinct documents linked to each of the given Parties. */
async function documentCounts(
	db: Db,
	partyIds: string[],
): Promise<Map<string, number>> {
	if (partyIds.length === 0) return new Map();
	const rows = await db
		.select({
			partyId: documentParty.partyId,
			value: countDistinct(documentParty.documentId),
		})
		.from(documentParty)
		.where(inArray(documentParty.partyId, partyIds))
		.groupBy(documentParty.partyId);
	return new Map(rows.map((row) => [row.partyId, row.value]));
}

async function setArchivedAt(
	db: Db,
	id: string,
	archivedAt: Date | null,
): Promise<Party> {
	await requireParty(db, id);
	const rows = await db
		.update(party)
		.set({ archivedAt })
		.where(eq(party.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${id}" not found.`,
		});
	}
	return row;
}

export function archiveParty(db: Db, id: string): Promise<Party> {
	return setArchivedAt(db, id, new Date());
}

export function unarchiveParty(db: Db, id: string): Promise<Party> {
	return setArchivedAt(db, id, null);
}

export async function deleteParty(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireParty(db, id);

	const linkedRows = await db
		.select({ value: countDistinct(documentParty.documentId) })
		.from(documentParty)
		.where(eq(documentParty.partyId, id));
	const linked = linkedRows[0]?.value ?? 0;
	if (linked > 0) {
		throw new ORPCError("CONFLICT", {
			message: `This Party is linked to ${linked} document(s): detach them or archive it.`,
		});
	}

	await db.delete(party).where(eq(party.id, id));
	return { id, deleted: true };
}

export async function addPartyRelation(
	db: Db,
	input: CreatePartyRelationInput,
): Promise<PartyRelation> {
	if (input.fromPartyId === input.toPartyId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "A Party cannot be linked to itself.",
		});
	}
	await requireParty(db, input.fromPartyId);
	await requireParty(db, input.toPartyId);

	const existing = await db
		.select({ id: partyRelation.id })
		.from(partyRelation)
		.where(
			and(
				eq(partyRelation.fromPartyId, input.fromPartyId),
				eq(partyRelation.toPartyId, input.toPartyId),
				eq(partyRelation.kind, input.kind),
			),
		)
		.limit(1);
	if (existing[0]) {
		throw new ORPCError("CONFLICT", {
			message: "This relation already exists.",
		});
	}

	const rows = await db
		.insert(partyRelation)
		.values({
			fromPartyId: input.fromPartyId,
			toPartyId: input.toPartyId,
			kind: input.kind,
			validFrom: input.validFrom ?? null,
			validUntil: input.validUntil ?? null,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The relation could not be created.",
		});
	}
	return row;
}

export async function removePartyRelation(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	const rows = await db
		.delete(partyRelation)
		.where(eq(partyRelation.id, id))
		.returning({ id: partyRelation.id });
	if (!rows[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: `Relation "${id}" not found.`,
		});
	}
	return { id, deleted: true };
}

/**
 * Exact lookup by identifier. Scalar keys use `->>`, array keys use the JSONB
 * existence operator `?`.
 */
export async function findPartiesByIdentifier(
	db: Db,
	kind: PartyIdentifierKind,
	value: string,
): Promise<Party[]> {
	const isScalar = (
		SCALAR_PARTY_IDENTIFIER_KINDS as readonly string[]
	).includes(kind);

	// Both sides canonical: "FR 12 345 678 901" finds the stored "FR12345678901".
	const needle = normalizeIdentifier(kind, value);
	const condition = isScalar
		? sql`${party.identifiers} ->> ${kind}::text = ${needle}`
		: sql`${party.identifiers} -> ${kind}::text ? ${needle}::text`;

	return db
		.select()
		.from(party)
		.where(condition)
		.orderBy(asc(party.name), asc(party.id));
}
