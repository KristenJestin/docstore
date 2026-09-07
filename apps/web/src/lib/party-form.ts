import {
	createPartyInput,
	type Party,
	type PartyIdentifierField,
	type PartyIdentifiers,
	partyTypeSchema,
} from "@docstore/shared/party";
import { z } from "zod";

/**
 * Display order of the identifiers — the business ones first, then the ways to
 * reach the party. `PARTY_IDENTIFIER_FIELDS` keeps the normalization order,
 * which is not the one a human reads.
 */
export const PARTY_IDENTIFIER_ORDER = [
	"siren",
	"siret",
	"vat",
	"customerRef",
	"domain",
	"email",
	"phone",
	"iban",
] as const satisfies readonly PartyIdentifierField[];

/** Singular English label of an identifier key, used wherever one is shown. */
export const PARTY_IDENTIFIER_LABELS: Record<PartyIdentifierField, string> = {
	siren: "SIREN",
	siret: "SIRET",
	vat: "VAT number",
	customerRef: "Customer number",
	domain: "Domain",
	email: "Email",
	phone: "Phone",
	iban: "IBAN",
};

/**
 * The form works with empty strings and arrays where the API expects missing
 * fields: this schema validates the input, `toPartyPayload` normalises it into
 * `createPartyInput` (the shared schema, source of truth).
 */
export const partyFormSchema = z.object({
	type: partyTypeSchema,
	name: z.string().trim().min(1, "Name is required.").max(200),
	aliases: z.array(z.string()),
	isHouseholdMember: z.boolean(),
	notes: z.string(),
	identifiers: z.object({
		siren: z.string(),
		siret: z.string(),
		vat: z.string(),
		customerRef: z.string(),
		iban: z.array(z.string()),
		email: z.array(z.email("Enter a valid email address.")),
		domain: z.array(z.string()),
		phone: z.array(z.string()),
	}),
});

export type PartyFormValues = z.infer<typeof partyFormSchema>;

export const EMPTY_PARTY_FORM: PartyFormValues = {
	type: "company",
	name: "",
	aliases: [],
	isHouseholdMember: false,
	notes: "",
	identifiers: {
		siren: "",
		siret: "",
		vat: "",
		customerRef: "",
		iban: [],
		email: [],
		domain: [],
		phone: [],
	},
};

/** Pre-fills the form from an existing Party. */
export function partyToFormValues(party: Party): PartyFormValues {
	return {
		type: party.type,
		name: party.name,
		aliases: party.aliases,
		isHouseholdMember: party.isHouseholdMember,
		notes: party.notes ?? "",
		identifiers: {
			siren: party.identifiers.siren ?? "",
			siret: party.identifiers.siret ?? "",
			vat: party.identifiers.vat ?? "",
			customerRef: party.identifiers.customerRef ?? "",
			iban: party.identifiers.iban ?? [],
			email: party.identifiers.email ?? [],
			domain: party.identifiers.domain ?? [],
			phone: party.identifiers.phone ?? [],
		},
	};
}

function cleanText(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function cleanList(values: string[]): string[] | undefined {
	const cleaned = values.map((value) => value.trim()).filter(Boolean);
	return cleaned.length > 0 ? cleaned : undefined;
}

/** Builds the JSONB `identifiers`, dropping every empty field. */
export function toPartyIdentifiers(
	values: PartyFormValues["identifiers"],
): PartyIdentifiers {
	const identifiers: PartyIdentifiers = {};
	const siren = cleanText(values.siren);
	if (siren) {
		identifiers.siren = siren;
	}
	const siret = cleanText(values.siret);
	if (siret) {
		identifiers.siret = siret;
	}
	const vat = cleanText(values.vat);
	if (vat) {
		identifiers.vat = vat;
	}
	const customerRef = cleanText(values.customerRef);
	if (customerRef) {
		identifiers.customerRef = customerRef;
	}
	const iban = cleanList(values.iban);
	if (iban) {
		identifiers.iban = iban;
	}
	const email = cleanList(values.email);
	if (email) {
		identifiers.email = email;
	}
	const domain = cleanList(values.domain);
	if (domain) {
		identifiers.domain = domain;
	}
	const phone = cleanList(values.phone);
	if (phone) {
		identifiers.phone = phone;
	}
	return identifiers;
}

/** Normalises then validates against the shared `createPartyInput` schema. */
export function toPartyPayload(values: PartyFormValues) {
	return createPartyInput.parse({
		type: values.type,
		name: values.name.trim(),
		aliases: values.aliases.map((alias) => alias.trim()).filter(Boolean),
		isHouseholdMember: values.isHouseholdMember,
		notes: cleanText(values.notes) ?? null,
		identifiers: toPartyIdentifiers(values.identifiers),
	});
}
