import { describe, expect, test } from "bun:test";
import {
	createPartyInput,
	mergeIdentifiers,
	normalizeIdentifier,
	normalizeIdentifiers,
	PARTY_TYPES,
	partyIdentifiersSchema,
	partyRelationKindSchema,
	partyTypeSchema,
	updatePartyInput,
} from "./party";

describe("partyTypeSchema", () => {
	test("accepts the known types", () => {
		for (const type of PARTY_TYPES) {
			expect(partyTypeSchema.parse(type)).toBe(type);
		}
	});

	test("rejects an unknown type", () => {
		expect(partyTypeSchema.safeParse("robot").success).toBe(false);
	});
});

describe("partyRelationKindSchema", () => {
	test("rejects an unknown relation kind", () => {
		expect(partyRelationKindSchema.safeParse("friend_of").success).toBe(false);
	});
});

describe("partyIdentifiersSchema", () => {
	test("every field is optional", () => {
		expect(partyIdentifiersSchema.parse({})).toEqual({});
	});

	test("validates the emails in the array", () => {
		expect(
			partyIdentifiersSchema.safeParse({ email: ["not-an-email"] }).success,
		).toBe(false);
		expect(
			partyIdentifiersSchema.parse({ email: ["contact@example.com"] }),
		).toEqual({ email: ["contact@example.com"] });
	});

	test("accepts multiple identifiers", () => {
		const parsed = partyIdentifiersSchema.parse({
			siren: "123456789",
			iban: ["FR7630006000011234567890189"],
			domain: ["example.com"],
			customerRef: "CLI-42",
		});
		expect(parsed.iban).toHaveLength(1);
		expect(parsed.customerRef).toBe("CLI-42");
	});
});

describe("createPartyInput", () => {
	test("applies the default values", () => {
		const parsed = createPartyInput.parse({ type: "company", name: "EDF" });
		expect(parsed.aliases).toEqual([]);
		expect(parsed.identifiers).toEqual({});
		expect(parsed.isHouseholdMember).toBe(false);
	});

	test("requires a non-empty name", () => {
		expect(
			createPartyInput.safeParse({ type: "person", name: " " }).success,
		).toBe(false);
	});

	test("refuses a household member that is not a person", () => {
		expect(
			createPartyInput.safeParse({
				type: "company",
				name: "ACME",
				isHouseholdMember: true,
			}).success,
		).toBe(false);
	});

	test("accepts a household member of type person", () => {
		const parsed = createPartyInput.parse({
			type: "person",
			name: "Camille Moreau",
			isHouseholdMember: true,
		});
		expect(parsed.isHouseholdMember).toBe(true);
	});
});

describe("updatePartyInput", () => {
	test("everything is optional", () => {
		expect(updatePartyInput.parse({})).toEqual({});
	});

	test("archivedAt accepts null or an ISO date", () => {
		expect(updatePartyInput.parse({ archivedAt: null }).archivedAt).toBeNull();
		expect(
			updatePartyInput.safeParse({ archivedAt: "2026-01-02T03:04:05Z" })
				.success,
		).toBe(true);
		expect(
			updatePartyInput.safeParse({ archivedAt: "yesterday" }).success,
		).toBe(false);
	});
});

describe("normalizeIdentifier", () => {
	test("strips spaces, dots and dashes from the legal identifiers", () => {
		expect(normalizeIdentifier("siren", "812 345 678")).toBe("812345678");
		expect(normalizeIdentifier("siret", "812.345.678.00013")).toBe(
			"81234567800013",
		);
		expect(normalizeIdentifier("siret", "812-345-678-00013")).toBe(
			"81234567800013",
		);
		expect(normalizeIdentifier("vat", " fr 12 812345678 ")).toBe(
			"FR12812345678",
		);
		expect(
			normalizeIdentifier("iban", "fr76 3000 6000 0112 3456 7890 189"),
		).toBe("FR7630006000011234567890189");
	});

	test("lowercases emails and domains, leaves the rest alone", () => {
		expect(normalizeIdentifier("email", " Contact@ACME.FR ")).toBe(
			"contact@acme.fr",
		);
		expect(normalizeIdentifier("domain", "ACME.fr")).toBe("acme.fr");
		expect(normalizeIdentifier("customerRef", " ABC-123 ")).toBe("ABC-123");
		expect(normalizeIdentifier("phone", " +33 1 23 45 67 89 ")).toBe(
			"+33 1 23 45 67 89",
		);
	});

	test("normalizes a whole identifiers object and drops the duplicates it creates", () => {
		expect(
			normalizeIdentifiers({
				siren: "812 345 678",
				email: ["Contact@ACME.fr", "contact@acme.fr"],
				iban: ["FR76 3000 6000 0112 3456 7890 189"],
			}),
		).toEqual({
			siren: "812345678",
			email: ["contact@acme.fr"],
			iban: ["FR7630006000011234567890189"],
		});
	});

	test("is idempotent", () => {
		const once = normalizeIdentifier("siret", "812 345 678 00013");
		expect(normalizeIdentifier("siret", once)).toBe(once);
	});
});

describe("normalizeIdentifier — domains", () => {
	test("reduces a pasted URL to its bare host", () => {
		expect(
			normalizeIdentifier(
				"domain",
				"https://www.nordwind-digital.example/path",
			),
		).toBe("nordwind-digital.example");
		expect(
			normalizeIdentifier("domain", "HTTP://NORDWIND-DIGITAL.EXAMPLE"),
		).toBe("nordwind-digital.example");
		expect(
			normalizeIdentifier("domain", " www.acme.fr:8443/contact?a=1 "),
		).toBe("acme.fr");
		expect(normalizeIdentifier("domain", "acme.fr.")).toBe("acme.fr");
		// A subdomain that is not `www` is a different host and stays.
		expect(normalizeIdentifier("domain", "https://mail.acme.fr")).toBe(
			"mail.acme.fr",
		);
	});

	test("is idempotent, and the spellings collapse into one", () => {
		const once = normalizeIdentifier("domain", "https://www.acme.fr/a");
		expect(normalizeIdentifier("domain", once)).toBe(once);
		expect(
			normalizeIdentifiers({
				domain: ["https://www.acme.fr/a", "ACME.fr", "https://"],
			}),
		).toEqual({ domain: ["acme.fr"] });
	});
});

describe("mergeIdentifiers", () => {
	const current = {
		siret: "90000001900027",
		email: ["contact@acme.fr"],
		domain: ["acme.fr"],
	};

	test("an absent key keeps its stored value", () => {
		expect(mergeIdentifiers(current, { siren: "900000019" })).toEqual({
			siret: "90000001900027",
			email: ["contact@acme.fr"],
			domain: ["acme.fr"],
			siren: "900000019",
		});
	});

	test("a key set to null is removed, a provided one replaces", () => {
		expect(
			mergeIdentifiers(current, { email: null, domain: ["acme.com"] }),
		).toEqual({ siret: "90000001900027", domain: ["acme.com"] });
	});

	test("an empty patch changes nothing", () => {
		expect(mergeIdentifiers(current, {})).toEqual(current);
	});
});

describe("updatePartyInput — identifiers patch", () => {
	test("a key can be nulled out, and `replaceIdentifiers` is a boolean", () => {
		const parsed = updatePartyInput.parse({
			identifiers: { siret: "90000001900027", email: null },
			replaceIdentifiers: true,
		});
		expect(parsed.identifiers).toEqual({
			siret: "90000001900027",
			email: null,
		});
		expect(parsed.replaceIdentifiers).toBe(true);
	});
});
