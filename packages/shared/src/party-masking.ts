import { mayReadSensitive, type ScopedCaller } from "./api-key";
import type {
	PartyIdentifierField,
	PartyIdentifiers,
	PartyType,
} from "./party";

/**
 * Party identifiers and notes behind the `sensitive` scope (issue #23).
 *
 * The decision is the same `mayReadSensitive` as for the content of sensitive
 * documents (`api-key.ts`): a browser session and a key carrying `sensitive`
 * (or `admin`) see a Party in full; any other key gets the masked view, with
 * `masked: true` when something was withheld. oRPC and MCP both go through
 * {@link maskParty}, so the two surfaces cannot drift.
 */

/**
 * D23-01: identifiers an organisation publishes to be recognised (company
 * registers, VAT number, web site). They stay visible to a `read` key on a
 * company, a public body or an association, because agents need them to
 * recognise issuers. Kept in sync with {@link PARTY_IDENTIFIER_FIELDS} by a
 * test.
 */
export const PUBLIC_PARTY_IDENTIFIER_FIELDS = [
	"siren",
	"siret",
	"vat",
	"domain",
] as const satisfies readonly PartyIdentifierField[];

/**
 * D23-01: identifiers that reach a person or an account (bank account, phone,
 * email, customer or contract number). Masked on every Party for a key
 * without `sensitive`.
 */
export const PRIVATE_PARTY_IDENTIFIER_FIELDS = [
	"iban",
	"email",
	"phone",
	"customerRef",
] as const satisfies readonly PartyIdentifierField[];

/** Replaces a masked value where a field cannot simply be left out. */
export const PARTY_MASKED_VALUE = "[masked: `sensitive` scope required]";

/** Message of the refusal of a lookup by a masked identifier type. */
export const PARTY_IDENTIFIER_SCOPE_REQUIRED =
	'This API key does not have the "sensitive" scope required to look a Party up by an IBAN or an email.';

const PUBLIC_FIELDS = new Set<string>(PUBLIC_PARTY_IDENTIFIER_FIELDS);

/**
 * D23-02: a person (household member or not) is private as a whole: every
 * identifier and the notes are masked, the public-looking ones included (a
 * sole trader's SIREN names the person).
 */
export function isPrivateParty(value: {
	type: PartyType | string;
	isHouseholdMember: boolean;
}): boolean {
	return value.type === "person" || value.isHouseholdMember;
}

/**
 * The masked view of a Party for `caller`. `masked` is `true` when a person
 * is served, or when an organisation had a private identifier withheld.
 */
export function maskParty<
	T extends {
		type: PartyType | string;
		isHouseholdMember: boolean;
		identifiers: PartyIdentifiers;
		notes: string | null;
	},
>(value: T, caller: ScopedCaller): T & { masked: boolean } {
	if (mayReadSensitive(caller)) return { ...value, masked: false };
	if (isPrivateParty(value)) {
		return { ...value, identifiers: {}, notes: null, masked: true };
	}
	const identifiers: Record<string, unknown> = {};
	let withheld = false;
	for (const [key, entry] of Object.entries(value.identifiers)) {
		if (PUBLIC_FIELDS.has(key)) {
			identifiers[key] = entry;
		} else if (entry !== undefined) {
			withheld = true;
		}
	}
	return {
		...value,
		identifiers: identifiers as PartyIdentifiers,
		masked: withheld,
	};
}

/**
 * D23-03: a lookup by a masked identifier type would be an oracle ("does this
 * IBAN belong to someone?"), so it is refused to a key without `sensitive`.
 */
export function mayFindPartyByIdentifier(
	caller: ScopedCaller,
	kind: string,
): boolean {
	return PUBLIC_FIELDS.has(kind) || mayReadSensitive(caller);
}

/**
 * D23-04: a `party.updated` entry of the activity log carries the before and
 * after of the identifiers. For a key without `sensitive` they become
 * `{ changed: true }`, like the notes already are, and the summary says
 * `masked: true`. The entry is returned as is when nothing is withheld.
 */
export function maskPartyActivityEntry<
	T extends { action: string; summary: Record<string, unknown> },
>(entry: T, caller: ScopedCaller): T {
	if (entry.action !== "party.updated" || mayReadSensitive(caller)) {
		return entry;
	}
	const fields = entry.summary.fields;
	if (
		typeof fields !== "object" ||
		fields === null ||
		!("identifiers" in fields)
	) {
		return entry;
	}
	return {
		...entry,
		summary: {
			...entry.summary,
			fields: { ...fields, identifiers: { changed: true } },
			masked: true,
		},
	};
}
