import { describe, expect, test } from "bun:test";
import { PARTY_IDENTIFIER_FIELDS, type PartyIdentifiers } from "./party";
import {
	maskParty,
	maskPartyActivityEntry,
	mayFindPartyByIdentifier,
	PRIVATE_PARTY_IDENTIFIER_FIELDS,
	PUBLIC_PARTY_IDENTIFIER_FIELDS,
} from "./party-masking";

const readKey = { scopes: ["read"] as const };
const sensitiveKey = { scopes: ["read", "sensitive"] as const };
const adminKey = { scopes: ["admin"] as const };

interface PartyFixture {
	type: "person" | "company";
	isHouseholdMember: boolean;
	identifiers: PartyIdentifiers;
	notes: string | null;
}

const householdMember: PartyFixture = {
	type: "person",
	isHouseholdMember: true,
	identifiers: {
		iban: ["FR7630006000011234567890189"],
		phone: ["+33600000000"],
		email: ["camille@example.com"],
		customerRef: "C-42",
	},
	notes: "Born in Lyon",
};

const company: PartyFixture = {
	type: "company",
	isHouseholdMember: false,
	identifiers: {
		siren: "552081317",
		siret: "55208131700019",
		vat: "FR03552081317",
		domain: ["edf.fr"],
		iban: ["FR7610000000000000000000000"],
		email: ["billing@edf.fr"],
		phone: ["+33900000000"],
		customerRef: "CLIENT-1",
	},
	notes: "Energy supplier",
};

describe("D23-01 the identifier lists", () => {
	test("every identifier key is either public or private, never both", () => {
		const all = [
			...PUBLIC_PARTY_IDENTIFIER_FIELDS,
			...PRIVATE_PARTY_IDENTIFIER_FIELDS,
		].sort();
		expect(all).toEqual([...PARTY_IDENTIFIER_FIELDS].sort());
	});
});

describe("maskParty", () => {
	test("WHEN a read key reads a household member THEN no identifier nor notes are returned and masked is true", () => {
		const masked = maskParty(householdMember, readKey);
		expect(masked.identifiers).toEqual({});
		expect(masked.notes).toBeNull();
		expect(masked.masked).toBe(true);
	});

	test("WHEN a read key reads a person that is not a household member THEN every identifier is masked, public ones included", () => {
		const person: PartyFixture = {
			...householdMember,
			isHouseholdMember: false,
			identifiers: { siren: "123456789", domain: ["moreau.example"] },
		};
		const masked = maskParty(person, readKey);
		expect(masked.identifiers).toEqual({});
		expect(masked.masked).toBe(true);
	});

	test("WHEN a read key reads a company THEN its SIREN, SIRET, VAT and domain stay visible and the private identifiers are masked", () => {
		const masked = maskParty(company, readKey);
		expect(masked.identifiers).toEqual({
			siren: "552081317",
			siret: "55208131700019",
			vat: "FR03552081317",
			domain: ["edf.fr"],
		});
		expect(masked.notes).toBe("Energy supplier");
		expect(masked.masked).toBe(true);
	});

	test("a company with only public identifiers is served unmasked", () => {
		const masked = maskParty(
			{ ...company, identifiers: { siren: "552081317" } },
			readKey,
		);
		expect(masked.identifiers).toEqual({ siren: "552081317" });
		expect(masked.masked).toBe(false);
	});

	test("WHEN a key with sensitive reads a household member THEN everything is returned", () => {
		const masked = maskParty(householdMember, sensitiveKey);
		expect(masked.identifiers).toEqual(householdMember.identifiers);
		expect(masked.notes).toBe("Born in Lyon");
		expect(masked.masked).toBe(false);
		expect(maskParty(householdMember, adminKey).masked).toBe(false);
	});

	test("a browser session sees everything", () => {
		expect(maskParty(householdMember, null)).toEqual({
			...householdMember,
			masked: false,
		});
	});
});

describe("mayFindPartyByIdentifier", () => {
	test("a read key may look up a public identifier but not an IBAN nor an email", () => {
		expect(mayFindPartyByIdentifier(readKey, "siren")).toBe(true);
		expect(mayFindPartyByIdentifier(readKey, "domain")).toBe(true);
		expect(mayFindPartyByIdentifier(readKey, "iban")).toBe(false);
		expect(mayFindPartyByIdentifier(readKey, "email")).toBe(false);
	});

	test("a key with sensitive and a session may look up anything", () => {
		expect(mayFindPartyByIdentifier(sensitiveKey, "iban")).toBe(true);
		expect(mayFindPartyByIdentifier(undefined, "email")).toBe(true);
	});
});

describe("maskPartyActivityEntry", () => {
	const entry: { action: string; summary: Record<string, unknown> } = {
		action: "party.updated",
		summary: {
			fields: {
				name: { before: "A", after: "B" },
				identifiers: {
					before: {},
					after: { iban: ["FR7630006000011234567890189"] },
				},
				notes: { changed: true },
			},
		},
	};

	test("WHEN a read key lists a Party update THEN the identifier values are withheld and the entry says masked", () => {
		const masked = maskPartyActivityEntry(entry, readKey);
		expect(masked.summary).toEqual({
			fields: {
				name: { before: "A", after: "B" },
				identifiers: { changed: true },
				notes: { changed: true },
			},
			masked: true,
		});
		expect(JSON.stringify(masked)).not.toContain("FR76");
	});

	test("a key with sensitive, and entries that are not Party updates, are left as they are", () => {
		expect(maskPartyActivityEntry(entry, sensitiveKey)).toBe(entry);
		const other = {
			action: "document.updated",
			summary: { fields: { identifiers: { before: 1, after: 2 } } },
		};
		expect(maskPartyActivityEntry(other, readKey)).toBe(other);
		const noIdentifiers = {
			action: "party.updated",
			summary: { fields: { name: { before: "A", after: "B" } } },
		};
		expect(maskPartyActivityEntry(noIdentifiers, readKey)).toBe(noIdentifiers);
	});
});
