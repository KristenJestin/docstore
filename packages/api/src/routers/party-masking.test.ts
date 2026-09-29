import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { party } from "@docstore/db/schema/party";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { PARTY_MASKED_VALUE } from "@docstore/shared/party-masking";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * Party identifiers and notes behind the `sensitive` scope (issue #23), oRPC
 * side. A household member's IBAN used to be readable with `read` alone.
 */

let db: TestDb;
let owner: TestUser;

const IBAN = "FR7630006000011234567890189";

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
});

function keyClient(scopes: ApiKeyScope[]) {
	return createTestClient(db, owner, { id: "key_test", scopes });
}

async function seedParties(): Promise<{ memberId: string; companyId: string }> {
	const rows = await db
		.insert(party)
		.values([
			{
				type: "person",
				name: "Camille Moreau",
				isHouseholdMember: true,
				identifiers: {
					siren: "123456789",
					iban: [IBAN],
					phone: ["+33600000000"],
					email: ["camille@example.com"],
					domain: ["moreau.example"],
					customerRef: "C-42",
				},
				notes: "Born in Lyon",
			},
			{
				type: "company",
				name: "EDF",
				identifiers: {
					siren: "552081317",
					siret: "55208131700019",
					vat: "FR03552081317",
					domain: ["edf.fr"],
					iban: ["FR7610000000000000000000000"],
					email: ["billing@edf.fr"],
					customerRef: "CLIENT-1",
				},
				notes: "Energy supplier",
			},
		])
		.returning({ id: party.id, type: party.type });
	const memberId = rows.find((row) => row.type === "person")?.id;
	const companyId = rows.find((row) => row.type === "company")?.id;
	if (!memberId || !companyId) throw new Error("parties not inserted");
	return { memberId, companyId };
}

describe("Docstore SHALL mask the personal identifiers and notes of Parties for an API key without the sensitive scope", () => {
	test("WHEN a read key reads a household member Party THEN it gets no IBAN, phone, email nor notes and masked is true", async () => {
		const { memberId } = await seedParties();
		const detail = await keyClient(["read"]).party.get({ id: memberId });
		expect(detail.name).toBe("Camille Moreau");
		expect(detail.identifiers).toEqual({});
		expect(detail.notes).toBeNull();
		expect(detail.masked).toBe(true);
		expect(JSON.stringify(detail)).not.toContain(IBAN);
	});

	test("WHEN the same key reads a company THEN it sees its SIREN, SIRET, VAT and domain, not its IBAN, email nor customer reference", async () => {
		const { companyId } = await seedParties();
		const detail = await keyClient(["read"]).party.get({ id: companyId });
		expect(detail.identifiers).toEqual({
			siren: "552081317",
			siret: "55208131700019",
			vat: "FR03552081317",
			domain: ["edf.fr"],
		});
		expect(detail.notes).toBe("Energy supplier");
		expect(detail.masked).toBe(true);
	});

	test("party.list masks every item the same way", async () => {
		await seedParties();
		const page = await keyClient(["read"]).party.list({});
		const member = page.items.find((item) => item.type === "person");
		const company = page.items.find((item) => item.type === "company");
		expect(member?.identifiers).toEqual({});
		expect(member?.notes).toBeNull();
		expect(member?.masked).toBe(true);
		expect(company?.identifiers.siren).toBe("552081317");
		expect(company?.identifiers.iban).toBeUndefined();
	});

	test("WHEN a read key searches Parties by a masked value THEN nothing matches", async () => {
		await seedParties();
		const client = keyClient(["read"]);
		expect((await client.party.list({ query: IBAN })).total).toBe(0);
		expect((await client.party.list({ query: "C-42" })).total).toBe(0);
		expect((await client.party.list({ query: "billing@edf" })).total).toBe(0);
		// A person's public-looking identifiers are masked too.
		expect((await client.party.list({ query: "123456789" })).total).toBe(0);
		// The name and a company's SIREN still find their Party.
		expect((await client.party.list({ query: "Camille" })).total).toBe(1);
		expect((await client.party.list({ query: "552081317" })).total).toBe(1);
	});

	test("the writes that return a Party mask it too", async () => {
		const { memberId } = await seedParties();
		const updated = await keyClient(["read", "write"]).party.update({
			id: memberId,
			aliases: ["Cam"],
		});
		expect(updated.identifiers).toEqual({});
		expect(updated.notes).toBeNull();
		expect(updated.masked).toBe(true);
	});

	test("WHEN a read key lists the duplicates THEN a domain shared by a person is not revealed", async () => {
		await seedParties();
		await db.insert(party).values({
			type: "person",
			name: "Moreau Camille",
			identifiers: { domain: ["moreau.example"] },
		});
		const pairs = await keyClient(["read"]).party.duplicates({});
		const pair = pairs.find((item) => item.reason === "sameDomain");
		expect(pair?.value).toBe(PARTY_MASKED_VALUE);
		const full = await keyClient(["read", "sensitive"]).party.duplicates({});
		expect(full.find((item) => item.reason === "sameDomain")?.value).toBe(
			"moreau.example",
		);
	});

	test("WHEN a read key lists a Party update in the activity log THEN the identifier values are withheld", async () => {
		const { memberId } = await seedParties();
		await createTestClient(db, owner).party.update({
			id: memberId,
			identifiers: { iban: ["FR7630006000019876543210123"] },
		});
		const page = await keyClient(["read"]).activity.list({
			action: "party.updated",
		});
		expect(page.items[0]?.summary).toMatchObject({
			fields: { identifiers: { changed: true } },
			masked: true,
		});
		expect(JSON.stringify(page.items)).not.toContain("FR76");
	});
});

describe("Docstore SHALL refuse a Party lookup by a masked identifier type for an API key without the sensitive scope", () => {
	test("WHEN a read key calls findByIdentifier by IBAN THEN the response is 403 FORBIDDEN", async () => {
		await seedParties();
		const error = await expectOrpcError(
			keyClient(["read"]).party.findByIdentifier({ kind: "iban", value: IBAN }),
			"FORBIDDEN",
		);
		expect(error.status).toBe(403);
		await expectOrpcError(
			keyClient(["read"]).party.findByIdentifier({
				kind: "email",
				value: "billing@edf.fr",
			}),
			"FORBIDDEN",
		);
	});

	test("a lookup by a public identifier still finds a company, never a person", async () => {
		const { companyId } = await seedParties();
		const client = keyClient(["read"]);
		const found = await client.party.findByIdentifier({
			kind: "siren",
			value: "552081317",
		});
		expect(found.map((item) => item.id)).toEqual([companyId]);
		expect(found[0]?.identifiers.iban).toBeUndefined();
		expect(
			await client.party.findByIdentifier({
				kind: "siren",
				value: "123456789",
			}),
		).toEqual([]);
	});
});

describe("Docstore SHALL keep serving Parties in full to a key with the sensitive scope and to a browser session", () => {
	test("WHEN a key with sensitive reads the household member THEN it sees every identifier and the notes", async () => {
		const { memberId } = await seedParties();
		const detail = await keyClient(["read", "sensitive"]).party.get({
			id: memberId,
		});
		expect(detail.identifiers.iban).toEqual([IBAN]);
		expect(detail.identifiers.phone).toEqual(["+33600000000"]);
		expect(detail.identifiers.email).toEqual(["camille@example.com"]);
		expect(detail.notes).toBe("Born in Lyon");
		expect(detail.masked).toBe(false);
		const found = await keyClient(["read", "sensitive"]).party.findByIdentifier(
			{ kind: "iban", value: IBAN },
		);
		expect(found.map((item) => item.id)).toEqual([memberId]);
		expect(
			(await keyClient(["read", "sensitive"]).party.list({ query: IBAN }))
				.total,
		).toBe(1);
	});

	test("a browser session sees everything", async () => {
		const { memberId } = await seedParties();
		const session = createTestClient(db, owner);
		const detail = await session.party.get({ id: memberId });
		expect(detail.identifiers.iban).toEqual([IBAN]);
		expect(detail.notes).toBe("Born in Lyon");
		expect(detail.masked).toBe(false);
		expect(
			await session.party.findByIdentifier({ kind: "iban", value: IBAN }),
		).toHaveLength(1);
	});
});
