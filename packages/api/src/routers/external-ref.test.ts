import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document } from "@docstore/db/schema/document";
import { documentExternalRef } from "@docstore/db/schema/external-ref";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import { settleActivityReads } from "@docstore/ingestion";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/** Issue #4 through oRPC: `document.setExternalRefs`, `get`, `list`. */

let db: TestDb;
let owner: TestUser;

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

async function seedDocument(
	title: string,
	options: { sensitive?: boolean } = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			sensitive: options.sensitive ?? false,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

const EDF = "10-admin/12-logement/contrat-edf.md";

describe("document.setExternalRefs", () => {
	test("WHEN an API client declares a wiki reference THEN document.get returns it and document.list filters on it", async () => {
		const client = createTestClient(db, owner);
		const cited = await seedDocument("EDF contract");
		await seedDocument("Passport");

		const updated = await client.document.setExternalRefs({
			id: cited,
			system: "wiki",
			refs: [{ ref: EDF, label: "Contrat EDF" }],
		});
		expect(updated.externalRefs.map((item) => item.ref)).toEqual([EDF]);

		const detail = await client.document.get({ id: cited });
		expect(detail.externalRefs).toMatchObject([
			{ system: "wiki", ref: EDF, label: "Contrat EDF", url: null },
		]);

		const referenced = await client.document.list({ referencedBy: "wiki" });
		expect(referenced.items.map((item) => item.title)).toEqual([
			"EDF contract",
		]);
		const notReferenced = await client.document.list({
			notReferencedBy: "wiki",
		});
		expect(notReferenced.items.map((item) => item.title)).toEqual(["Passport"]);
	});

	test("WHEN an API key without the write scope sets references THEN it is refused", async () => {
		const id = await seedDocument("EDF contract");
		const reader = createTestClient(db, owner, {
			id: "key_read",
			scopes: ["read"],
		});
		await expectOrpcError(
			reader.document.setExternalRefs({
				id,
				system: "wiki",
				refs: [{ ref: EDF }],
			}),
			"FORBIDDEN",
		);
	});

	test("WHEN the document does not exist THEN it answers NOT_FOUND", async () => {
		const client = createTestClient(db, owner);
		await expectOrpcError(
			client.document.setExternalRefs({
				id: "doc_missing",
				system: "wiki",
				refs: [],
			}),
			"NOT_FOUND",
		);
	});
});

/**
 * Issue #34: the external references of a sensitive document are masked for
 * an API key without the `sensitive` scope, like its notes and field values
 * (#22). A wiki path such as `10-admin/17-sante/…` says too much.
 */
describe("Docstore SHALL mask the external references of a sensitive document for an API key without sensitive", () => {
	const HEALTH = "10-admin/17-sante/diagnostic.md";

	function keyClient(scopes: ApiKeyScope[]) {
		return createTestClient(db, owner, { id: "key_test", scopes });
	}

	/** A sensitive document the wiki cites, and a plain one it does not. */
	async function seedCitedDiagnosis(): Promise<{
		diagnosis: string;
		passport: string;
	}> {
		const diagnosis = await seedDocument("Diagnosis", { sensitive: true });
		const passport = await seedDocument("Passport");
		await db.insert(documentExternalRef).values({
			documentId: diagnosis,
			system: "wiki",
			ref: HEALTH,
			label: "Diagnostic",
		});
		return { diagnosis, passport };
	}

	test("WHEN a read key gets a sensitive document with wiki refs THEN externalRefs is empty and masked is true", async () => {
		const { diagnosis } = await seedCitedDiagnosis();
		const detail = await keyClient(["read"]).document.get({ id: diagnosis });
		expect(detail.externalRefs).toEqual([]);
		expect(detail.masked).toBe(true);
		expect(JSON.stringify(detail)).not.toContain("17-sante");
	});

	test("WHEN a write key sets refs on a sensitive document THEN the document it gets back has no refs", async () => {
		const { diagnosis } = await seedCitedDiagnosis();
		const updated = await keyClient(["read", "write"]).document.setExternalRefs(
			{ id: diagnosis, system: "notes", refs: [{ ref: "health/visit.md" }] },
		);
		expect(updated.externalRefs).toEqual([]);
		expect(updated.masked).toBe(true);
		const renamed = await keyClient(["read", "write"]).document.update({
			id: diagnosis,
			title: "Diagnosis 2026",
		});
		expect(renamed.externalRefs).toEqual([]);
	});

	test("WHEN a read key filters referencedBy wiki THEN the sensitive document is not returned", async () => {
		await seedCitedDiagnosis();
		const plain = await seedDocument("EDF contract");
		await db
			.insert(documentExternalRef)
			.values({ documentId: plain, system: "wiki", ref: EDF });
		const page = await keyClient(["read"]).document.list({
			referencedBy: "wiki",
		});
		expect(page.items.map((item) => item.title)).toEqual(["EDF contract"]);
	});

	test("WHEN a read key filters notReferencedBy wiki THEN no sensitive document is returned either way", async () => {
		const { passport } = await seedCitedDiagnosis();
		await seedDocument("Blood test", { sensitive: true });
		const page = await keyClient(["read"]).document.list({
			notReferencedBy: "wiki",
		});
		expect(page.items.map((item) => item.id)).toEqual([passport]);
	});

	test("WHEN a key with sensitive or a session reads it THEN it sees the refs and the filters match as before", async () => {
		const { diagnosis, passport } = await seedCitedDiagnosis();
		const blood = await seedDocument("Blood test", { sensitive: true });
		for (const client of [
			keyClient(["read", "sensitive"]),
			createTestClient(db, owner),
		]) {
			const detail = await client.document.get({ id: diagnosis });
			expect(detail.externalRefs).toMatchObject([
				{ system: "wiki", ref: HEALTH, label: "Diagnostic" },
			]);
			expect(detail.masked).toBe(false);
			const cited = await client.document.list({ referencedBy: "wiki" });
			expect(cited.items.map((item) => item.id)).toEqual([diagnosis]);
			const orphans = await client.document.list({
				notReferencedBy: "wiki",
			});
			expect(orphans.items.map((item) => item.id).sort()).toEqual(
				[passport, blood].sort(),
			);
		}
	});

	test("WHEN a read key lists the activity of document.external_refs_set on a sensitive document THEN the paths are hidden", async () => {
		const diagnosis = await seedDocument("Diagnosis", { sensitive: true });
		await createTestClient(db, owner).document.setExternalRefs({
			id: diagnosis,
			system: "wiki",
			refs: [{ ref: HEALTH }],
		});
		await settleActivityReads();

		const page = await keyClient(["read"]).activity.list({
			objectId: diagnosis,
			action: "document.external_refs_set",
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.summary).toEqual({
			system: "wiki",
			added: 1,
			removed: 0,
			masked: true,
		});
		expect(JSON.stringify(page.items)).not.toContain("17-sante");

		const full = await keyClient(["read", "sensitive"]).activity.list({
			objectId: diagnosis,
			action: "document.external_refs_set",
		});
		expect(JSON.stringify(full.items)).toContain(HEALTH);
	});
});
