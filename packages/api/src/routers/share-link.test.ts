import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document } from "@docstore/db/schema/document";
import { documentDossier, dossier } from "@docstore/db/schema/dossier";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	issueShareAccessToken,
	shareItems,
	shareLinkState,
	verifyShareAccessToken,
	verifySharePassword,
} from "../services/share-link.service";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

beforeAll(async () => {
	db = await createTestDb();
	process.env.PUBLIC_URL ||= "http://127.0.0.1:3000";
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
});

async function seedDocument(
	title: string,
	overrides: { sensitive?: boolean } = {},
): Promise<string> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			sensitive: overrides.sensitive ?? false,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	return id;
}

async function seedDossier(name: string, documentIds: string[]) {
	const rows = await db
		.insert(dossier)
		.values({ name })
		.returning({ id: dossier.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("dossier not inserted");
	if (documentIds.length > 0) {
		await db
			.insert(documentDossier)
			.values(documentIds.map((documentId) => ({ documentId, dossierId: id })));
	}
	return id;
}

describe("shareLink — lifecycle", () => {
	test("create, list, revoke, delete", async () => {
		const documentId = await seedDocument("Water bill");

		const { link, url } = await client.shareLink.create({
			documentId,
			allowDownload: true,
		});
		expect(link.id).toStartWith("shl_");
		expect(link.token).toHaveLength(32);
		expect(link.kind).toBe("document");
		expect(link.targetTitle).toBe("Water bill");
		expect(link.hasPassword).toBe(false);
		expect(url).toBe(`http://127.0.0.1:3000/s/${link.token}`);

		const listed = await client.shareLink.list({ documentId });
		expect(listed.map((item) => item.id)).toEqual([link.id]);

		const revoked = await client.shareLink.revoke({ id: link.id });
		expect(revoked.revokedAt).not.toBeNull();
		// Revoked links leave the default listing but remain auditable.
		expect(await client.shareLink.list({ documentId })).toHaveLength(0);
		expect(
			await client.shareLink.list({ documentId, includeInactive: true }),
		).toHaveLength(1);

		expect(await client.shareLink.delete({ id: link.id })).toEqual({
			id: link.id,
			deleted: true,
		});
		await expectOrpcError(
			client.shareLink.revoke({ id: link.id }),
			"NOT_FOUND",
		);
	});

	test("a link targets exactly one object", async () => {
		const documentId = await seedDocument("Lease");
		const dossierId = await seedDossier("Housing", [documentId]);

		// Neither target: the Zod refinement rejects it.
		await expectOrpcError(
			client.shareLink.create({ allowDownload: true }),
			"BAD_REQUEST",
		);
		await expectOrpcError(
			client.shareLink.create({ documentId, dossierId, allowDownload: true }),
			"BAD_REQUEST",
		);
	});

	test("a sensitive document cannot be shared", async () => {
		const documentId = await seedDocument("Blood test", { sensitive: true });
		const error = await expectOrpcError(
			client.shareLink.create({ documentId, allowDownload: true }),
			"BAD_REQUEST",
		);
		expect(error.message).toContain("sensitive");
	});

	test("a dossier holding a sensitive document cannot be shared either", async () => {
		const plain = await seedDocument("Deed");
		const secret = await seedDocument("Medical file", { sensitive: true });
		const dossierId = await seedDossier("Mixed", [plain, secret]);

		await expectOrpcError(
			client.shareLink.create({ dossierId, allowDownload: true }),
			"BAD_REQUEST",
		);
	});

	test("an unknown target is refused", async () => {
		await expectOrpcError(
			client.shareLink.create({
				documentId: "doc_missing",
				allowDownload: true,
			}),
			"NOT_FOUND",
		);
		await expectOrpcError(
			client.shareLink.create({
				dossierId: "dos_missing",
				allowDownload: true,
			}),
			"NOT_FOUND",
		);
	});
});

describe("shareLink — state and items", () => {
	test("expiry, revocation and quota all close the link", async () => {
		const documentId = await seedDocument("Invoice");
		const { link } = await client.shareLink.create({
			documentId,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			maxViews: 2,
			allowDownload: true,
		});

		const rows = await db.query.shareLink.findMany();
		const row = rows[0];
		if (!row) throw new Error("row not found");

		expect(shareLinkState(row).usable).toBe(true);
		expect(shareLinkState(row, new Date(Date.now() + 120_000)).expired).toBe(
			true,
		);
		expect(shareLinkState({ ...row, views: 2 }).exhausted).toBe(true);
		expect(shareLinkState({ ...row, revokedAt: new Date() }).revoked).toBe(
			true,
		);
		expect(link.views).toBe(0);
	});

	test("a dossier link lists its live, non-sensitive documents", async () => {
		const first = await seedDocument("Estimate");
		const second = await seedDocument("Final invoice");
		const dossierId = await seedDossier("Works", [first, second]);
		await client.shareLink.create({ dossierId, allowDownload: true });

		const rows = await db.query.shareLink.findMany();
		const row = rows[0];
		if (!row) throw new Error("row not found");

		expect((await shareItems(db, row)).map((item) => item.id).sort()).toEqual(
			[first, second].sort(),
		);

		// A document that turns sensitive after the fact leaves the link.
		await db.update(document).set({ sensitive: true });
		expect(await shareItems(db, row)).toHaveLength(0);
	});
});

describe("shareLink — password and access token", () => {
	test("the password is hashed and verified", async () => {
		const documentId = await seedDocument("Payslip");
		const { link } = await client.shareLink.create({
			documentId,
			password: "correct horse",
			allowDownload: true,
		});
		expect(link.hasPassword).toBe(true);

		const rows = await db.query.shareLink.findMany();
		const row = rows[0];
		if (!row) throw new Error("row not found");
		// Never stored in the clear.
		expect(row.passwordHash).not.toBe("correct horse");
		expect(await verifySharePassword(row, "correct horse")).toBe(true);
		expect(await verifySharePassword(row, "wrong")).toBe(false);
	});

	test("the access token is bound to its link and expires", () => {
		const secret = "app-secret-app-secret-app-secret";
		const now = new Date();
		const { accessToken, expiresIn } = issueShareAccessToken(
			"shl_one",
			secret,
			now,
		);
		expect(expiresIn).toBe(3600);
		expect(verifyShareAccessToken(accessToken, "shl_one", secret, now)).toBe(
			true,
		);
		// Another link, another secret, a stale token or a forgery: all refused.
		expect(verifyShareAccessToken(accessToken, "shl_two", secret, now)).toBe(
			false,
		);
		expect(
			verifyShareAccessToken(accessToken, "shl_one", "another-secret", now),
		).toBe(false);
		expect(
			verifyShareAccessToken(
				accessToken,
				"shl_one",
				secret,
				new Date(now.getTime() + 3_600_001),
			),
		).toBe(false);
		expect(verifyShareAccessToken("garbage", "shl_one", secret, now)).toBe(
			false,
		);
		expect(verifyShareAccessToken(undefined, "shl_one", secret, now)).toBe(
			false,
		);
	});
});
