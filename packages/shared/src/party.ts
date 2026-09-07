import { z } from "zod";
import { dateOnlySchema } from "./common";

/**
 * Party enum values. Single source of truth: the PostgreSQL enums of
 * `@docstore/db` are built from these constants.
 */
export const PARTY_TYPES = [
	"person",
	"company",
	"public_body",
	"association",
] as const;

export const PARTY_RELATION_KINDS = [
	"works_at",
	"child_of",
	"spouse_of",
	"subsidiary_of",
	"contact_of",
] as const;

export const partyTypeSchema = z.enum(PARTY_TYPES);
export type PartyType = z.infer<typeof partyTypeSchema>;

export const partyRelationKindSchema = z.enum(PARTY_RELATION_KINDS);
export type PartyRelationKind = z.infer<typeof partyRelationKindSchema>;

/**
 * Every key of `party.identifiers`, in the order they are normalized.
 * `siren`, `siret`, `vat` and `customerRef` are scalars, the rest are arrays.
 */
export const PARTY_IDENTIFIER_FIELDS = [
	"siren",
	"siret",
	"vat",
	"iban",
	"email",
	"domain",
	"phone",
	"customerRef",
] as const;
export type PartyIdentifierField = (typeof PARTY_IDENTIFIER_FIELDS)[number];

/** Keys compared without any separator, in uppercase. */
const UPPERCASE_IDENTIFIER_FIELDS = new Set<string>([
	"siren",
	"siret",
	"vat",
	"iban",
]);

/** Keys that only ever differ by case. */
const LOWERCASE_IDENTIFIER_FIELDS = new Set<string>(["email", "domain"]);

/**
 * Canonical host of a `domain` identifier.
 *
 * People paste what their browser shows them — `https://www.nordwind.example/`,
 * `www.nordwind.example`, `nordwind.example:443/contact` — and all four name
 * the same issuer. Scheme, `www.`, port, path, query and fragment are dropped
 * and what is left is lowercased, so the stored value is what a logo fetch or
 * an email domain can be compared against.
 *
 * @example normalizeDomain("https://www.nordwind.example/path") // "nordwind.example"
 */
function normalizeDomain(value: string): string {
	const host = value
		.trim()
		.toLowerCase()
		// Scheme (`https://`, `ftp://`…).
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
		// Path, query or fragment: everything from the first separator on.
		.replace(/[/?#].*$/, "")
		// Port.
		.replace(/:\d+$/, "");
	// `www.` is a prefix of the same host, and a trailing dot is the DNS root.
	return host.replace(/^www\./, "").replace(/\.+$/, "");
}

/**
 * Canonical form of an identifier, so that "812 345 678", "812.345.678" and
 * "812-345-678" are the same SIREN, and `Contact@ACME.FR` the same email.
 *
 * Applied on both sides of every comparison — storage (`party.create`/
 * `update`), lookup (`party.findByIdentifier`, `party.list`) and the ingestion
 * matching — so an identifier typed by hand still finds its Party.
 *
 * @example normalizeIdentifier("siret", "812 345 678 00013") // "81234567800013"
 * @example normalizeIdentifier("email", " Contact@ACME.FR ") // "contact@acme.fr"
 * @example normalizeIdentifier("domain", "https://www.acme.fr/a") // "acme.fr"
 */
export function normalizeIdentifier(kind: string, value: string): string {
	const trimmed = value.trim();
	if (UPPERCASE_IDENTIFIER_FIELDS.has(kind)) {
		// Spaces (non-breaking included), dots and every flavour of dash.
		return trimmed.replace(/[\s.\-‐-―−]/g, "").toUpperCase();
	}
	if (kind === "domain") {
		return normalizeDomain(trimmed);
	}
	if (LOWERCASE_IDENTIFIER_FIELDS.has(kind)) {
		return trimmed.toLowerCase();
	}
	return trimmed;
}

/** Same normalization applied to a whole `identifiers` object. */
export function normalizeIdentifiers(
	identifiers: PartyIdentifiers,
): PartyIdentifiers {
	const result: Record<string, unknown> = { ...identifiers };
	for (const key of PARTY_IDENTIFIER_FIELDS) {
		const value = result[key];
		if (typeof value === "string") {
			result[key] = normalizeIdentifier(key, value);
		} else if (Array.isArray(value)) {
			const normalized = value
				.filter((item): item is string => typeof item === "string")
				.map((item) => normalizeIdentifier(key, item))
				// A `domain` reduced to nothing ("https://") carries no information.
				.filter((item) => item.length > 0);
			// Normalizing can collapse two spellings into one.
			result[key] = [...new Set(normalized)];
		}
	}
	return result as PartyIdentifiers;
}

/** Business identifiers stored as JSONB on `party.identifiers`. */
export const partyIdentifiersSchema = z.object({
	siren: z.string().trim().min(1).optional(),
	siret: z.string().trim().min(1).optional(),
	vat: z.string().trim().min(1).optional(),
	iban: z.array(z.string().trim().min(1)).optional(),
	email: z.array(z.email()).optional(),
	domain: z.array(z.string().trim().min(1)).optional(),
	phone: z.array(z.string().trim().min(1)).optional(),
	customerRef: z.string().trim().min(1).optional(),
});
export type PartyIdentifiers = z.infer<typeof partyIdentifiersSchema>;

/**
 * Patch on `party.identifiers`, key by key: an absent key is left untouched and
 * an explicit `null` removes it.
 *
 * `party.update` is a partial patch everywhere else; identifiers used to be the
 * one field where sending `{ siret }` silently dropped the emails and the
 * domains stored next to it. Full replacement is still available through
 * `replaceIdentifiers: true`.
 */
export const partyIdentifiersPatchSchema = z.object({
	siren: z.string().trim().min(1).nullish(),
	siret: z.string().trim().min(1).nullish(),
	vat: z.string().trim().min(1).nullish(),
	iban: z.array(z.string().trim().min(1)).nullish(),
	email: z.array(z.email()).nullish(),
	domain: z.array(z.string().trim().min(1)).nullish(),
	phone: z.array(z.string().trim().min(1)).nullish(),
	customerRef: z.string().trim().min(1).nullish(),
});
export type PartyIdentifiersPatch = z.infer<typeof partyIdentifiersPatchSchema>;

/**
 * Applies a patch to a stored `identifiers` object: a key set to `null` is
 * removed, a key absent from the patch keeps its stored value.
 */
export function mergeIdentifiers(
	current: PartyIdentifiers,
	patch: PartyIdentifiersPatch,
): PartyIdentifiers {
	const result: Record<string, unknown> = { ...current };
	for (const key of PARTY_IDENTIFIER_FIELDS) {
		const value = patch[key];
		// `undefined` is "not in the patch"; `null` is "remove this key".
		if (value === undefined) continue;
		if (value === null) {
			delete result[key];
		} else {
			result[key] = value;
		}
	}
	return result as PartyIdentifiers;
}

const partyFields = {
	type: partyTypeSchema,
	name: z.string().trim().min(1).max(200),
	aliases: z.array(z.string().trim().min(1)),
	logoKey: z.string().min(1).nullish(),
	identifiers: partyIdentifiersSchema,
	isHouseholdMember: z.boolean(),
	userId: z.string().min(1).nullish(),
	notes: z.string().nullish(),
};

export const createPartyInput = z
	.object({
		...partyFields,
		aliases: partyFields.aliases.default([]),
		identifiers: partyFields.identifiers.default({}),
		isHouseholdMember: partyFields.isHouseholdMember.default(false),
	})
	// Household members are Parties of type `person` (SPEC §2), the same guard
	// as `updatePartyInput`/`updateParty`.
	.refine((value) => !value.isHouseholdMember || value.type === "person", {
		message: 'A household member must be of type "person".',
		path: ["isHouseholdMember"],
	});
export type CreatePartyInput = z.infer<typeof createPartyInput>;

/**
 * Partial patch: no default is applied, an absent field is left unchanged.
 *
 * `identifiers` is itself a patch (see {@link partyIdentifiersPatchSchema});
 * `replaceIdentifiers: true` restores the old "the object replaces everything"
 * behaviour, for a form that owns the whole identifier block.
 */
export const updatePartyInput = z
	.object({
		...partyFields,
		identifiers: partyIdentifiersPatchSchema,
		replaceIdentifiers: z.boolean(),
		archivedAt: z.iso.datetime({ offset: true }).nullish(),
	})
	.partial();
export type UpdatePartyInput = z.infer<typeof updatePartyInput>;

/** Absorption of one Party into another (`party.mergeInto`). */
export const mergePartiesInput = z.object({
	/** Party being absorbed: archived once everything has moved. */
	sourceId: z.string().min(1),
	/** Party that keeps everything. */
	targetId: z.string().min(1),
});
export type MergePartiesInput = z.infer<typeof mergePartiesInput>;

/** Representation of a Party as exposed by the API. */
export const partySchema = z.object({
	id: z.string(),
	type: partyTypeSchema,
	name: z.string(),
	aliases: z.array(z.string()),
	logoKey: z.string().nullable(),
	identifiers: partyIdentifiersSchema,
	isHouseholdMember: z.boolean(),
	userId: z.string().nullable(),
	notes: z.string().nullable(),
	archivedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
export type Party = z.infer<typeof partySchema>;

export const partyRelationSchema = z.object({
	id: z.string(),
	fromPartyId: z.string(),
	toPartyId: z.string(),
	kind: partyRelationKindSchema,
	validFrom: z.string().nullable(),
	validUntil: z.string().nullable(),
	createdAt: z.date(),
});
export type PartyRelation = z.infer<typeof partyRelationSchema>;

/** Lightweight version of a Party, for lists and links. */
export const partySummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	type: partyTypeSchema,
	logoKey: z.string().nullable(),
});
export type PartySummary = z.infer<typeof partySummarySchema>;

/** Relation enriched with the Party on the other side of the link. */
export const partyRelationWithPartySchema = partyRelationSchema.extend({
	otherParty: partySummarySchema,
});
export type PartyRelationWithParty = z.infer<
	typeof partyRelationWithPartySchema
>;

/** Party + outgoing/incoming relations + number of linked documents. */
export const partyDetailSchema = partySchema.extend({
	relationsFrom: z.array(partyRelationWithPartySchema),
	relationsTo: z.array(partyRelationWithPartySchema),
	documentCount: z.int().min(0),
});
export type PartyDetail = z.infer<typeof partyDetailSchema>;

export const listPartiesInput = z.object({
	/** Case-insensitive search on the name, aliases and identifiers. */
	query: z.string().trim().min(1).optional(),
	type: partyTypeSchema.optional(),
	includeArchived: z.boolean().default(false),
	page: z.int().min(1).default(1),
	pageSize: z.int().min(1).max(100).default(25),
});
export type ListPartiesInput = z.infer<typeof listPartiesInput>;

/** `identifiers` keys on which an exact search is possible. */
export const PARTY_IDENTIFIER_KINDS = [
	"siren",
	"siret",
	"vat",
	"iban",
	"email",
	"domain",
] as const;

export const partyIdentifierKindSchema = z.enum(PARTY_IDENTIFIER_KINDS);
export type PartyIdentifierKind = z.infer<typeof partyIdentifierKindSchema>;

/** Scalar keys are compared with `->>`, the others with `?`. */
export const SCALAR_PARTY_IDENTIFIER_KINDS = ["siren", "siret", "vat"] as const;

export const findPartyByIdentifierInput = z.object({
	kind: partyIdentifierKindSchema,
	value: z.string().trim().min(1),
});
export type FindPartyByIdentifierInput = z.infer<
	typeof findPartyByIdentifierInput
>;

/** Why two Parties look like the same one (`party.duplicates`). */
export const PARTY_DUPLICATE_REASONS = ["sameDomain", "sameName"] as const;
export const partyDuplicateReasonSchema = z.enum(PARTY_DUPLICATE_REASONS);
export type PartyDuplicateReason = z.infer<typeof partyDuplicateReasonSchema>;

/**
 * Candidate pair, ordered so `partyId` is the older of the two: the natural
 * `targetId` of a `party.mergeInto`.
 */
export const partyDuplicateSchema = z.object({
	partyId: z.string(),
	partyName: z.string(),
	partyLogoKey: z.string().nullable(),
	partyDocumentCount: z.int().min(0),
	otherPartyId: z.string(),
	otherPartyName: z.string(),
	otherPartyLogoKey: z.string().nullable(),
	otherPartyDocumentCount: z.int().min(0),
	reason: partyDuplicateReasonSchema,
	/** The shared domain, or the shared normalised name. */
	value: z.string(),
});
export type PartyDuplicate = z.infer<typeof partyDuplicateSchema>;

/** Result of `party.mergeInto`. */
export const mergePartiesResultSchema = z.object({
	target: partyDetailSchema,
	archivedId: z.string(),
	/** Document links moved onto the target. */
	movedDocuments: z.int().min(0),
	/** Party relations re-pointed at the target. */
	movedRelations: z.int().min(0),
});
export type MergePartiesResult = z.infer<typeof mergePartiesResultSchema>;

export const createPartyRelationInput = z.object({
	fromPartyId: z.string().min(1),
	toPartyId: z.string().min(1),
	kind: partyRelationKindSchema,
	validFrom: dateOnlySchema.nullish(),
	validUntil: dateOnlySchema.nullish(),
});
export type CreatePartyRelationInput = z.infer<typeof createPartyRelationInput>;
