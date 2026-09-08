import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiKey } from "@docstore/api/services/api-key.service";
import {
	createShareLink,
	revokeShareLink,
} from "@docstore/api/services/share-link.service";
import { auth } from "@docstore/auth";
import { createId } from "@docstore/db/id";
import { user } from "@docstore/db/schema/auth";
import { document, documentFile } from "@docstore/db/schema/document";
import { documentDossier, dossier } from "@docstore/db/schema/dossier";
import { shareLink } from "@docstore/db/schema/share";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import {
	createIngestionContext,
	intakeFile,
	isCreated,
} from "@docstore/ingestion";
import type {
	CreateShareLinkInput,
	PublicShare,
	ShareUnlockResult,
} from "@docstore/shared/share-link";
import { deriveStorageMasterKey, ENCRYPTION_MAGIC } from "@docstore/storage";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { createApp } from "./app";
import { resetShareState } from "./share-link";

/**
 * Public share links and encryption at rest, exercised through
 * `app.request()`: no port is opened, so the development server can keep
 * running alongside.
 */

const PDF_PATH = fileURLToPath(
	new URL(
		"../../../packages/ocr/test/fixtures/text-layer.pdf",
		import.meta.url,
	),
);

const APP_SECRET = "share-link-test-secret-share-link-test";

let db: TestDb;
let app: Hono;
let userId: string;
let pdf: Uint8Array;
let storageRoot: string;
let ingestion: IngestionBinding;

beforeAll(async () => {
	db = await createTestDb();
	pdf = new Uint8Array(await Bun.file(PDF_PATH).arrayBuffer());
	storageRoot = join(
		process.env.TEMP ?? "/tmp",
		`docstore-share-test-${createId("")}`,
	);
	process.env.PUBLIC_URL ||= "http://127.0.0.1:3000";
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	resetShareState();

	userId = createId("usr_");
	await db.insert(user).values({
		id: userId,
		name: "Camille Moreau",
		email: `${userId}@example.test`,
	});

	ingestion = {
		ctx: createIngestionContext({
			db,
			storagePath: storageRoot,
			tools: {
				tesseractPath: process.env.TESSERACT_PATH || undefined,
				tessdataPrefix: process.env.TESSDATA_PREFIX || undefined,
				popplerPath: process.env.POPPLER_PATH || undefined,
			},
			encryption: { masterKey: deriveStorageMasterKey(APP_SECRET) },
		}),
	};

	app = createApp({
		db,
		auth,
		ingestion,
		corsOrigin: "http://127.0.0.1:3001",
		appSecret: APP_SECRET,
		logRequests: false,
	});
});

/** Distinct IP per call: the rate limiter and the view counter are per IP. */
let ipCounter = 0;
function nextIp(): string {
	ipCounter += 1;
	return `198.51.100.${(ipCounter % 250) + 1}`;
}

/** Byte-by-byte comparison, free of the `Uint8Array` variance dance. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Each document gets its own bytes: identical content would be caught by the
 * duplicate detection of `intakeFile`. A PDF tolerates a trailing comment.
 */
function uniquePdf(marker: string): Uint8Array {
	const suffix = new TextEncoder().encode(`
% ${marker}
`);
	const bytes = new Uint8Array(pdf.byteLength + suffix.byteLength);
	bytes.set(pdf, 0);
	bytes.set(suffix, pdf.byteLength);
	return bytes;
}

async function seedDocument(title: string): Promise<{
	documentId: string;
	fileId: string;
	bytes: Uint8Array;
}> {
	const bytes = uniquePdf(`${title}-${createId("")}`);
	const result = await intakeFile(ingestion.ctx, {
		data: bytes,
		filename: `${title}.pdf`,
		mime: "application/pdf",
		createdById: userId,
		title,
	});
	if (!isCreated(result)) throw new Error("expected a created document");
	return { documentId: result.documentId, fileId: result.fileId, bytes };
}

async function makeLink(
	overrides: Partial<CreateShareLinkInput> & {
		documentId?: string;
		dossierId?: string;
	},
): Promise<string> {
	const created = await createShareLink(db, userId, {
		allowDownload: true,
		...overrides,
	} as CreateShareLinkInput);
	return created.link.token;
}

async function getShare(
	token: string,
	query = "",
): Promise<{ status: number; body: PublicShare }> {
	const response = await app.request(`/api/s/${token}${query}`, {
		headers: { "x-forwarded-for": nextIp() },
	});
	return {
		status: response.status,
		body: (await response.json()) as PublicShare,
	};
}

describe("GET /api/s/:token", () => {
	test("returns the metadata and the items of a document link", async () => {
		const { documentId, fileId } = await seedDocument("Water bill");
		const token = await makeLink({ documentId });

		const { status, body } = await getShare(token);
		expect(status).toBe(200);
		expect(body.kind).toBe("document");
		expect(body.title).toBe("Water bill");
		expect(body.requiresPassword).toBe(false);
		expect(body.expired).toBe(false);
		expect(body.revoked).toBe(false);
		expect(body.allowDownload).toBe(true);
		expect(body.items).toHaveLength(1);
		expect(body.items[0]).toMatchObject({
			id: documentId,
			title: "Water bill",
			fileId,
			mime: "application/pdf",
		});
	});

	test("lists every document of a dossier link", async () => {
		const first = await seedDocument("Estimate");
		const second = await seedDocument("Final invoice");
		const rows = await db
			.insert(dossier)
			.values({ name: "Works" })
			.returning({ id: dossier.id });
		const dossierId = rows[0]?.id;
		if (!dossierId) throw new Error("dossier not inserted");
		await db.insert(documentDossier).values([
			{ documentId: first.documentId, dossierId },
			{ documentId: second.documentId, dossierId },
		]);

		const token = await makeLink({ dossierId });
		const { body } = await getShare(token);
		expect(body.kind).toBe("dossier");
		expect(body.title).toBe("Works");
		expect(body.items).toHaveLength(2);
	});

	test("responds 404 on an unknown token", async () => {
		const response = await app.request("/api/s/nope", {
			headers: { "x-forwarded-for": nextIp() },
		});
		expect(response.status).toBe(404);
	});

	test("reports expiry and revocation without hiding the page", async () => {
		const { documentId } = await seedDocument("Old lease");
		// `createShareLink` refuses an expiry already behind us — a link born dead
		// is never what the caller meant — so the only honest way to get an expired
		// one is to mint it valid and let the clock catch up with it.
		const expiredToken = await makeLink({
			documentId,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});
		await db
			.update(shareLink)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(shareLink.token, expiredToken));
		const expired = await getShare(expiredToken);
		expect(expired.status).toBe(200);
		expect(expired.body.expired).toBe(true);
		expect(expired.body.items).toHaveLength(0);

		const second = await seedDocument("Current lease");
		const created = await createShareLink(db, userId, {
			documentId: second.documentId,
			allowDownload: true,
		});
		await revokeShareLink(db, created.link.id);
		const revoked = await getShare(created.link.token);
		expect(revoked.body.revoked).toBe(true);
		expect(revoked.body.items).toHaveLength(0);
	});

	test("counts one view per IP per hour, not one per request", async () => {
		const { documentId } = await seedDocument("Statement");
		const token = await makeLink({ documentId });
		const ip = nextIp();

		for (let index = 0; index < 3; index += 1) {
			await app.request(`/api/s/${token}`, {
				headers: { "x-forwarded-for": ip },
			});
		}
		const [row] = await db
			.select()
			.from(shareLink)
			.where(eq(shareLink.token, token));
		expect(row?.views).toBe(1);
	});

	test("responds 410 once the view quota is reached", async () => {
		const { documentId } = await seedDocument("Quota");
		const token = await makeLink({ documentId, maxViews: 1 });

		const first = await getShare(token);
		expect(first.body.items).toHaveLength(1);

		// The next visitor finds the link used up.
		const second = await getShare(token);
		expect(second.body.expired).toBe(true);
		expect(second.body.items).toHaveLength(0);

		const download = await app.request(`/api/s/${token}/files/x/download`, {
			headers: { "x-forwarded-for": nextIp() },
		});
		expect(download.status).toBe(410);
	});
});

describe("POST /api/s/:token/unlock", () => {
	test("a password hides the items until it is verified", async () => {
		const { documentId, fileId, bytes } = await seedDocument("Payslip");
		const token = await makeLink({ documentId, password: "open sesame" });

		const locked = await getShare(token);
		expect(locked.body.requiresPassword).toBe(true);
		expect(locked.body.items).toHaveLength(0);

		const denied = await app.request(
			`/api/s/${token}/files/${fileId}/download`,
			{
				headers: { "x-forwarded-for": nextIp() },
			},
		);
		expect(denied.status).toBe(401);

		const wrong = await app.request(`/api/s/${token}/unlock`, {
			method: "POST",
			body: JSON.stringify({ password: "nope" }),
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": nextIp(),
			},
		});
		expect(wrong.status).toBe(401);

		const unlock = await app.request(`/api/s/${token}/unlock`, {
			method: "POST",
			body: JSON.stringify({ password: "open sesame" }),
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": nextIp(),
			},
		});
		expect(unlock.status).toBe(200);
		const { accessToken } = (await unlock.json()) as ShareUnlockResult;

		const unlocked = await getShare(token, `?access=${accessToken}`);
		expect(unlocked.body.items).toHaveLength(1);

		const download = await app.request(
			`/api/s/${token}/files/${fileId}/download?access=${accessToken}`,
			{ headers: { "x-forwarded-for": nextIp() } },
		);
		expect(download.status).toBe(200);
		expect(sameBytes(new Uint8Array(await download.arrayBuffer()), bytes)).toBe(
			true,
		);
	});
});

describe("GET /api/s/:token/files/:fileId/download", () => {
	test("serves the original file", async () => {
		const { documentId, fileId, bytes } = await seedDocument("Deed");
		const token = await makeLink({ documentId });

		const response = await app.request(
			`/api/s/${token}/files/${fileId}/download`,
			{
				headers: { "x-forwarded-for": nextIp() },
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/pdf");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		expect(sameBytes(new Uint8Array(await response.arrayBuffer()), bytes)).toBe(
			true,
		);
	});

	test("refuses a file that belongs to another document", async () => {
		const shared = await seedDocument("Shared");
		const other = await seedDocument("Private");
		const token = await makeLink({ documentId: shared.documentId });

		const response = await app.request(
			`/api/s/${token}/files/${other.fileId}/download`,
			{ headers: { "x-forwarded-for": nextIp() } },
		);
		expect(response.status).toBe(404);
	});

	test("allowDownload: false blocks the file", async () => {
		const { documentId, fileId } = await seedDocument("Preview only");
		const token = await makeLink({ documentId, allowDownload: false });

		const response = await app.request(
			`/api/s/${token}/files/${fileId}/download`,
			{
				headers: { "x-forwarded-for": nextIp() },
			},
		);
		expect(response.status).toBe(403);
	});

	test("rate limits a burst from one IP", async () => {
		const { documentId } = await seedDocument("Hammered");
		const token = await makeLink({ documentId });
		const ip = nextIp();

		let last = 200;
		for (let index = 0; index < 32; index += 1) {
			const response = await app.request(`/api/s/${token}`, {
				headers: { "x-forwarded-for": ip },
			});
			last = response.status;
		}
		expect(last).toBe(429);
	});
});

describe("encryption at rest, end to end", () => {
	test("document.update encrypts on disk while the download stays readable", async () => {
		const { documentId, fileId, bytes } = await seedDocument("Blood test");
		const [before] = await db
			.select()
			.from(documentFile)
			.where(eq(documentFile.id, fileId));
		if (!before) throw new Error("file not found");

		const diskPath = join(storageRoot, before.storageKey);
		expect(sameBytes(new Uint8Array(await readFile(diskPath)), bytes)).toBe(
			true,
		);

		const key = await createApiKey(db, userId, {
			name: "Test key",
			scopes: ["read", "write", "sensitive"],
		});
		const authHeader = { Authorization: `Bearer ${key.secret}` };

		// A fake thumbnail: the pipeline is not run here (no queue, no binaries).
		const thumbKey = `thumbnails/${documentId}/${fileId}.png`;
		const png = new TextEncoder().encode("fake-png");
		await ingestion.ctx.storage.put(thumbKey, png);
		await db
			.update(documentFile)
			.set({ thumbnailKey: thumbKey })
			.where(eq(documentFile.id, fileId));

		// Goes through `document.update`, therefore through the router hook.
		const patched = await app.request(
			`/api-reference/documents/${documentId}`,
			{
				method: "PATCH",
				body: JSON.stringify({ sensitive: true }),
				headers: { "content-type": "application/json", ...authHeader },
			},
		);
		expect(patched.status).toBe(200);

		const encrypted = new Uint8Array(await readFile(diskPath));
		expect(new TextDecoder().decode(encrypted.subarray(0, 4))).toBe(
			ENCRYPTION_MAGIC,
		);
		expect(sameBytes(encrypted, bytes)).toBe(false);
		expect(
			new TextDecoder().decode(
				new Uint8Array(await readFile(join(storageRoot, thumbKey))).subarray(
					0,
					4,
				),
			),
		).toBe(ENCRYPTION_MAGIC);

		const [after] = await db
			.select()
			.from(documentFile)
			.where(eq(documentFile.id, fileId));
		expect(after?.encrypted).toBe(true);
		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, documentId));
		expect(doc?.sensitive).toBe(true);

		// The download route decrypts transparently.
		const download = await app.request(`/files/${fileId}/download`, {
			headers: authHeader,
		});
		expect(download.status).toBe(200);
		expect(sameBytes(new Uint8Array(await download.arrayBuffer()), bytes)).toBe(
			true,
		);

		const thumbnail = await app.request(`/files/${fileId}/thumbnail`, {
			headers: authHeader,
		});
		expect(thumbnail.status).toBe(200);
		expect(sameBytes(new Uint8Array(await thumbnail.arrayBuffer()), png)).toBe(
			true,
		);

		// A sensitive document is no longer shareable.
		let refused = false;
		try {
			await createShareLink(db, userId, { documentId, allowDownload: true });
		} catch {
			refused = true;
		}
		expect(refused).toBe(true);

		// Unsetting the flag puts the plaintext back.
		const restored = await app.request(
			`/api-reference/documents/${documentId}`,
			{
				method: "PATCH",
				body: JSON.stringify({ sensitive: false }),
				headers: { "content-type": "application/json", ...authHeader },
			},
		);
		expect(restored.status).toBe(200);
		expect(sameBytes(new Uint8Array(await readFile(diskPath)), bytes)).toBe(
			true,
		);
		expect(
			sameBytes(
				new Uint8Array(await readFile(join(storageRoot, thumbKey))),
				png,
			),
		).toBe(true);
	});
});
