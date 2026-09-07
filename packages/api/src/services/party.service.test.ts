import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document, documentParty } from "@docstore/db/schema/document";
import { party } from "@docstore/db/schema/party";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { eq } from "drizzle-orm";
import { createTestUser, expectOrpcError } from "../test-utils";
import {
	addPartyRelation,
	archiveParty,
	createParty,
	deleteParty,
	findPartiesByIdentifier,
	getParty,
	listParties,
	listPartyDuplicates,
	mergeParties,
	removePartyRelation,
	unarchiveParty,
	updateParty,
} from "./party.service";

let db: TestDb;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
});

const listDefaults = {
	includeArchived: false,
	page: 1,
	pageSize: 25,
} as const;

async function seedEdf() {
	return createParty(db, {
		type: "company",
		name: "EDF",
		aliases: ["Électricité de France"],
		identifiers: {
			siren: "552081317",
			email: ["contact@edf.fr"],
			domain: ["edf.fr"],
		},
		isHouseholdMember: false,
	});
}

describe("party.service — CRUD", () => {
	test("creates, reads, updates and deletes a Party", async () => {
		const created = await seedEdf();
		expect(created.id).toStartWith("prt_");
		expect(created.aliases).toEqual(["Électricité de France"]);

		const detail = await getParty(db, created.id);
		expect(detail.name).toBe("EDF");
		expect(detail.documentCount).toBe(0);
		expect(detail.relationsFrom).toEqual([]);

		const updated = await updateParty(db, created.id, {
			name: "EDF SA",
			notes: "Electricity supplier",
		});
		expect(updated.name).toBe("EDF SA");
		expect(updated.notes).toBe("Electricity supplier");

		const removed = await deleteParty(db, created.id);
		expect(removed).toEqual({ id: created.id, deleted: true });
		await expectOrpcError(getParty(db, created.id), "NOT_FOUND");
	});

	test("NOT_FOUND on an unknown identifier", async () => {
		await expectOrpcError(getParty(db, "prt_unknown"), "NOT_FOUND");
	});

	test("CONFLICT on an already used SIREN", async () => {
		await seedEdf();
		await expectOrpcError(
			createParty(db, {
				type: "company",
				name: "Other company",
				aliases: [],
				identifiers: { siren: "552081317" },
				isHouseholdMember: false,
			}),
			"CONFLICT",
		);
	});

	test("archives then unarchives, and honours includeArchived", async () => {
		const created = await seedEdf();
		const archived = await archiveParty(db, created.id);
		expect(archived.archivedAt).not.toBeNull();

		const hidden = await listParties(db, listDefaults);
		expect(hidden.total).toBe(0);

		const shown = await listParties(db, {
			...listDefaults,
			includeArchived: true,
		});
		expect(shown.total).toBe(1);

		const restored = await unarchiveParty(db, created.id);
		expect(restored.archivedAt).toBeNull();
	});
});

describe("party.service — search", () => {
	beforeEach(async () => {
		await seedEdf();
		await createParty(db, {
			type: "person",
			name: "Camille Moreau",
			aliases: ["Christophe Dupont"],
			identifiers: { email: ["camille@example.test"] },
			isHouseholdMember: true,
		});
	});

	test("finds by name, case-insensitively", async () => {
		const found = await listParties(db, { ...listDefaults, query: "edf" });
		expect(found.items.map((item) => item.name)).toEqual(["EDF"]);
	});

	test("finds by alias", async () => {
		const found = await listParties(db, {
			...listDefaults,
			query: "Christophe",
		});
		expect(found.items.map((item) => item.name)).toEqual(["Camille Moreau"]);
	});

	test("finds by identifier (email, domain, siren)", async () => {
		const byEmail = await listParties(db, {
			...listDefaults,
			query: "contact@edf.fr",
		});
		expect(byEmail.total).toBe(1);

		const byDomain = await listParties(db, {
			...listDefaults,
			query: "edf.fr",
		});
		expect(byDomain.total).toBe(1);

		const bySiren = await listParties(db, {
			...listDefaults,
			query: "552081317",
		});
		expect(bySiren.total).toBe(1);
	});

	test("filters by type and sorts by name", async () => {
		const persons = await listParties(db, { ...listDefaults, type: "person" });
		expect(persons.items.map((item) => item.name)).toEqual(["Camille Moreau"]);

		const all = await listParties(db, listDefaults);
		expect(all.items.map((item) => item.name)).toEqual([
			"Camille Moreau",
			"EDF",
		]);
	});

	test("paginates", async () => {
		const page = await listParties(db, {
			...listDefaults,
			page: 2,
			pageSize: 1,
		});
		expect(page.total).toBe(2);
		expect(page.totalPages).toBe(2);
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.name).toBe("EDF");
	});

	test("findPartiesByIdentifier: scalar key and array key", async () => {
		const bySiren = await findPartiesByIdentifier(db, "siren", "552081317");
		expect(bySiren.map((item) => item.name)).toEqual(["EDF"]);

		const byEmail = await findPartiesByIdentifier(
			db,
			"email",
			"camille@example.test",
		);
		expect(byEmail.map((item) => item.name)).toEqual(["Camille Moreau"]);

		const byDomain = await findPartiesByIdentifier(db, "domain", "edf.fr");
		expect(byDomain.map((item) => item.name)).toEqual(["EDF"]);

		expect(await findPartiesByIdentifier(db, "siret", "000")).toEqual([]);
	});
});

describe("party.service — relations and deletion", () => {
	test("adds then removes a relation, rejects duplicates", async () => {
		const employer = await seedEdf();
		const person = await createParty(db, {
			type: "person",
			name: "Camille Moreau",
			aliases: [],
			identifiers: {},
			isHouseholdMember: true,
		});

		const relation = await addPartyRelation(db, {
			fromPartyId: person.id,
			toPartyId: employer.id,
			kind: "works_at",
			validFrom: "2020-01-01",
		});
		expect(relation.kind).toBe("works_at");
		expect(relation.validFrom).toBe("2020-01-01");

		const detail = await getParty(db, person.id);
		expect(detail.relationsFrom).toHaveLength(1);
		expect(detail.relationsFrom[0]?.otherParty.name).toBe("EDF");

		const employerDetail = await getParty(db, employer.id);
		expect(employerDetail.relationsTo).toHaveLength(1);

		await expectOrpcError(
			addPartyRelation(db, {
				fromPartyId: person.id,
				toPartyId: employer.id,
				kind: "works_at",
			}),
			"CONFLICT",
		);

		const removed = await removePartyRelation(db, relation.id);
		expect(removed).toEqual({ id: relation.id, deleted: true });
		await expectOrpcError(removePartyRelation(db, relation.id), "NOT_FOUND");
	});

	test("rejects deleting a Party linked to a document", async () => {
		const owner = await createTestUser(db);
		const issuer = await seedEdf();

		const rows = await db
			.insert(document)
			.values({
				title: "EDF invoice",
				status: "active",
				createdById: owner.id,
			})
			.returning({ id: document.id });
		const documentId = rows[0]?.id;
		if (!documentId) throw new Error("document was not inserted");

		await db
			.insert(documentParty)
			.values({ documentId, partyId: issuer.id, role: "issuer" });

		await expectOrpcError(deleteParty(db, issuer.id), "CONFLICT");

		const detail = await getParty(db, issuer.id);
		expect(detail.documentCount).toBe(1);
	});
});

describe("party — identifier normalisation", () => {
	test("stores the canonical form, whatever the spelling", async () => {
		const created = await createParty(db, {
			type: "company",
			name: "Nordwind Digital",
			aliases: [],
			identifiers: {
				siret: "900 000 019 00027",
				vat: "fr 25 900000019",
				email: ["Contact@Nordwind.example"],
			},
			isHouseholdMember: false,
		});

		expect(created.identifiers).toEqual({
			siret: "90000001900027",
			vat: "FR25900000019",
			email: ["contact@nordwind.example"],
		});
	});

	test("a lookup normalizes its needle too", async () => {
		await createParty(db, {
			type: "company",
			name: "Nordwind Digital",
			aliases: [],
			identifiers: {
				siret: "90000001900027",
				email: ["contact@nordwind.example"],
			},
			isHouseholdMember: false,
		});

		for (const value of [
			"90000001900027",
			"900 000 019 00027",
			"900.000.019.00027",
			"900-000-019-00027",
		]) {
			expect(
				(await findPartiesByIdentifier(db, "siret", value)).map(
					(row) => row.name,
				),
			).toEqual(["Nordwind Digital"]);
		}

		expect(
			await findPartiesByIdentifier(db, "email", "CONTACT@NORDWIND.EXAMPLE"),
		).toHaveLength(1);
	});

	test("the search finds a spaced identifier", async () => {
		await createParty(db, {
			type: "company",
			name: "Nordwind Digital",
			aliases: [],
			identifiers: { siren: "900000019" },
			isHouseholdMember: false,
		});

		const page = await listParties(db, {
			query: "900 000 019",
			includeArchived: false,
			page: 1,
			pageSize: 25,
		});
		expect(page.items.map((row) => row.name)).toEqual(["Nordwind Digital"]);
	});

	test("update normalizes too, and the duplicate check sees it", async () => {
		await createParty(db, {
			type: "company",
			name: "First",
			aliases: [],
			identifiers: { siren: "900000019" },
			isHouseholdMember: false,
		});
		const second = await createParty(db, {
			type: "company",
			name: "Second",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});

		const error = await updateParty(db, second.id, {
			identifiers: { siren: "900 000 019" },
		}).then(
			() => null,
			(caught: unknown) => caught as { code?: string },
		);
		expect(error?.code).toBe("CONFLICT");
	});
});

describe("party.update — household members", () => {
	test("a household member cannot leave the `person` type", async () => {
		const person = await createParty(db, {
			type: "person",
			name: "Camille Moreau",
			aliases: [],
			identifiers: {},
			isHouseholdMember: true,
		});

		const error = await updateParty(db, person.id, { type: "company" }).then(
			() => null,
			(caught: unknown) => caught as { code?: string },
		);
		expect(error?.code).toBe("BAD_REQUEST");

		// Dropping the flag first makes the change possible.
		await updateParty(db, person.id, { isHouseholdMember: false });
		expect((await updateParty(db, person.id, { type: "company" })).type).toBe(
			"company",
		);
	});

	test("marking a non-person as a household member is refused", async () => {
		const company = await createParty(db, {
			type: "company",
			name: "ACME",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});

		const error = await updateParty(db, company.id, {
			isHouseholdMember: true,
		}).then(
			() => null,
			(caught: unknown) => caught as { code?: string },
		);
		expect(error?.code).toBe("BAD_REQUEST");
	});
});

describe("party.create — household members", () => {
	test("creating a non-person as a household member is refused", async () => {
		// Same guard as `party.update`, but on `createParty` directly: MCP's
		// `create_party` tool calls this service without going through the
		// shared `createPartyInput` refine.
		const error = await createParty(db, {
			type: "company",
			name: "ACME",
			aliases: [],
			identifiers: {},
			isHouseholdMember: true,
		}).then(
			() => null,
			(caught: unknown) => caught as { code?: string },
		);
		expect(error?.code).toBe("BAD_REQUEST");
	});

	test("a household member of type person is created normally", async () => {
		const person = await createParty(db, {
			type: "person",
			name: "Camille Moreau",
			aliases: [],
			identifiers: {},
			isHouseholdMember: true,
		});
		expect(person.isHouseholdMember).toBe(true);
	});
});

describe("party.update — identifiers are a patch", () => {
	test("a partial patch keeps the identifiers it does not name", async () => {
		const created = await seedEdf();

		const updated = await updateParty(db, created.id, {
			identifiers: { siret: "552 081 317 00074" },
		});
		expect(updated.identifiers).toEqual({
			siren: "552081317",
			siret: "55208131700074",
			email: ["contact@edf.fr"],
			domain: ["edf.fr"],
		});
	});

	test("a key set to null removes it", async () => {
		const created = await seedEdf();

		const updated = await updateParty(db, created.id, {
			identifiers: { email: null },
		});
		expect(updated.identifiers).toEqual({
			siren: "552081317",
			domain: ["edf.fr"],
		});
	});

	test("`replaceIdentifiers` restores the full replacement", async () => {
		const created = await seedEdf();

		const updated = await updateParty(db, created.id, {
			identifiers: { siret: "55208131700074" },
			replaceIdentifiers: true,
		});
		expect(updated.identifiers).toEqual({ siret: "55208131700074" });
	});

	test("the merged value is normalized before it is stored", async () => {
		const created = await seedEdf();

		const updated = await updateParty(db, created.id, {
			identifiers: { domain: ["https://www.edf.fr/particuliers"] },
		});
		expect(updated.identifiers.domain).toEqual(["edf.fr"]);
	});
});

describe("party — duplicate domains", () => {
	test("two live Parties cannot share a domain", async () => {
		await seedEdf();

		await expectOrpcError(
			createParty(db, {
				type: "company",
				name: "EDF Entreprises",
				aliases: [],
				identifiers: { domain: ["https://www.edf.fr/pro"] },
				isHouseholdMember: false,
			}),
			"CONFLICT",
		);
	});

	test("the message names the Party already holding it", async () => {
		const edf = await seedEdf();
		const other = await createParty(db, {
			type: "company",
			name: "Other",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});

		const error = await expectOrpcError(
			updateParty(db, other.id, { identifiers: { domain: ["edf.fr"] } }),
			"CONFLICT",
		);
		expect(error.message).toContain("EDF");
		expect(error.message).toContain(edf.id);
	});

	test("an archived Party is out of the way", async () => {
		const edf = await seedEdf();
		await archiveParty(db, edf.id);

		const replacement = await createParty(db, {
			type: "company",
			name: "EDF SA",
			aliases: [],
			identifiers: { domain: ["edf.fr"] },
			isHouseholdMember: false,
		});
		expect(replacement.identifiers.domain).toEqual(["edf.fr"]);
	});
});

describe("party.mergeInto", () => {
	async function seedDocumentFor(
		partyId: string,
		title: string,
		role: "issuer" | "recipient" = "issuer",
	): Promise<string> {
		const owner = await createTestUser(db);
		const rows = await db
			.insert(document)
			.values({ title, status: "active", createdById: owner.id })
			.returning({ id: document.id });
		const documentId = rows[0]?.id;
		if (!documentId) throw new Error("document was not inserted");
		await db.insert(documentParty).values({ documentId, partyId, role });
		return documentId;
	}

	test("moves documents, relations, identifiers and aliases, then archives", async () => {
		const target = await seedEdf();
		const source = await createParty(db, {
			type: "company",
			name: "E.D.F.",
			aliases: ["EDF SA"],
			identifiers: { siret: "552081317 00074", phone: ["+33 1 00 00 00 00"] },
			isHouseholdMember: false,
		});
		const person = await createParty(db, {
			type: "person",
			name: "Camille Moreau",
			aliases: [],
			identifiers: {},
			isHouseholdMember: true,
		});

		const documentId = await seedDocumentFor(source.id, "Old invoice");
		await addPartyRelation(db, {
			fromPartyId: person.id,
			toPartyId: source.id,
			kind: "works_at",
		});

		const result = await mergeParties(db, {
			sourceId: source.id,
			targetId: target.id,
		});
		expect(result.archivedId).toBe(source.id);
		expect(result.movedDocuments).toBe(1);
		expect(result.movedRelations).toBe(1);

		// The union of the identifiers lands on the survivor...
		expect(result.target.identifiers).toEqual({
			siren: "552081317",
			siret: "55208131700074",
			email: ["contact@edf.fr"],
			domain: ["edf.fr"],
			phone: ["+33 1 00 00 00 00"],
		});
		// ...the absorbed name and aliases stay searchable...
		expect([...result.target.aliases].sort()).toEqual([
			"E.D.F.",
			"EDF SA",
			"Électricité de France",
		]);
		expect(result.target.documentCount).toBe(1);
		expect(result.target.relationsTo).toHaveLength(1);

		// ...and the source keeps nothing that could still match a lookup.
		const archived = await getParty(db, source.id);
		expect(archived.archivedAt).not.toBeNull();
		expect(archived.identifiers).toEqual({});
		expect(archived.documentCount).toBe(0);
		expect(
			(await findPartiesByIdentifier(db, "siret", "55208131700074")).map(
				(row) => row.id,
			),
		).toEqual([target.id]);

		const links = await db
			.select({ partyId: documentParty.partyId })
			.from(documentParty)
			.where(eq(documentParty.documentId, documentId));
		expect(links.map((row) => row.partyId)).toEqual([target.id]);
	});

	test("a document linked to both sides under the same role keeps one link", async () => {
		const target = await seedEdf();
		const source = await createParty(db, {
			type: "company",
			name: "EDF bis",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		const documentId = await seedDocumentFor(target.id, "Shared");
		await db
			.insert(documentParty)
			.values({ documentId, partyId: source.id, role: "issuer" });

		await mergeParties(db, { sourceId: source.id, targetId: target.id });

		const links = await db
			.select({ partyId: documentParty.partyId })
			.from(documentParty)
			.where(eq(documentParty.documentId, documentId));
		expect(links.map((row) => row.partyId)).toEqual([target.id]);
	});

	test("a relation between the two merged Parties disappears", async () => {
		const target = await seedEdf();
		const source = await createParty(db, {
			type: "company",
			name: "EDF subsidiary",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		await addPartyRelation(db, {
			fromPartyId: source.id,
			toPartyId: target.id,
			kind: "subsidiary_of",
		});

		const merged = await mergeParties(db, {
			sourceId: source.id,
			targetId: target.id,
		});
		expect(merged.target.relationsFrom).toEqual([]);
		expect(merged.target.relationsTo).toEqual([]);
	});

	test("refuses merging a Party into itself, and an unknown one", async () => {
		const edf = await seedEdf();
		await expectOrpcError(
			mergeParties(db, { sourceId: edf.id, targetId: edf.id }),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			mergeParties(db, { sourceId: "prt_missing", targetId: edf.id }),
			"NOT_FOUND",
		);
	});

	test("the survivor stays editable afterwards", async () => {
		const target = await seedEdf();
		const source = await createParty(db, {
			type: "company",
			name: "EDF bis",
			aliases: [],
			identifiers: { vat: "FR03552081317" },
			isHouseholdMember: false,
		});
		await mergeParties(db, { sourceId: source.id, targetId: target.id });

		// The archived source no longer trips the duplicate check.
		const renamed = await updateParty(db, target.id, { notes: "Merged" });
		expect(renamed.notes).toBe("Merged");
	});
});

describe("party.duplicates", () => {
	test("reports the pairs sharing a domain or a name", async () => {
		const edf = await seedEdf();
		const sameDomain = await createParty(db, {
			type: "company",
			name: "EDF Entreprises",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		// Written straight to the column: `party.update` would refuse the domain.
		await db
			.update(party)
			.set({ identifiers: { domain: ["edf.fr"] } })
			.where(eq(party.id, sameDomain.id));

		const first = await createParty(db, {
			type: "person",
			name: "Camille Moreau",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		const second = await createParty(db, {
			type: "company",
			name: "  camille   moreau ",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});

		const duplicates = await listPartyDuplicates(db);
		expect(duplicates).toHaveLength(2);

		const domainPair = duplicates.find((row) => row.reason === "sameDomain");
		expect(domainPair?.partyId).toBe(edf.id);
		expect(domainPair?.otherPartyId).toBe(sameDomain.id);
		expect(domainPair?.value).toBe("edf.fr");

		const namePair = duplicates.find((row) => row.reason === "sameName");
		expect(namePair?.partyId).toBe(first.id);
		expect(namePair?.otherPartyId).toBe(second.id);
		expect(namePair?.value).toBe("camille moreau");
	});

	test("archived Parties and merged ones drop out", async () => {
		const target = await seedEdf();
		// Same name once whitespace is collapsed, different enough for the
		// `lower(name)` check of `party.create`.
		const source = await createParty(db, {
			type: "company",
			name: " EDF ",
			aliases: [],
			identifiers: {},
			isHouseholdMember: false,
		});
		expect(await listPartyDuplicates(db)).toHaveLength(1);

		await mergeParties(db, { sourceId: source.id, targetId: target.id });
		expect(await listPartyDuplicates(db)).toEqual([]);
	});
});
