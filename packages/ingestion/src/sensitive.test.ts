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
import { createId } from "@docstore/db/id";
import { document, documentFile } from "@docstore/db/schema/document";
import { documentDossier, dossier } from "@docstore/db/schema/dossier";
import { shareLink } from "@docstore/db/schema/share";
import type { TestDb } from "@docstore/db/test-utils";
import { createTestDb, truncateAll } from "@docstore/db/test-utils";
import { ENCRYPTION_MAGIC, thumbnailKey } from "@docstore/storage";
import { eq } from "drizzle-orm";
import type { IngestionContext } from "./context";
import { intakeFile, isDuplicate } from "./intake";
import {
	setSensitive,
	storageForFile,
	sweepSensitiveShareLinks,
} from "./sensitive";
import {
	createTestIngestion,
	FIXTURES,
	insertTestUser,
	readFixture,
	type TestIngestion,
} from "./test-utils";

/**
 * Encryption at rest driven by the `sensitive` flag (SPEC §8 iteration 7).
 *
 * Assertions go down to the bytes on disk: the point of the feature is that a
 * copy of the storage folder gives nothing away.
 */

let db: TestDb;
let ingestion: TestIngestion;
let ctx: IngestionContext;
let userId: string;
let pdf: Uint8Array;

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
	ctx = ingestion.ctx;
	pdf = await readFixture(FIXTURES.textLayerPdf);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	userId = await insertTestUser(db);
});

/** Raw bytes as they sit on disk, bypassing every driver. */
async function bytesOnDisk(
	storageKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const buffer = await readFile(join(ingestion.rootDir, "storage", storageKey));
	return new Uint8Array(
		buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength,
		) as ArrayBuffer,
	);
}

/** Byte-by-byte comparison, free of the `Uint8Array` variance dance. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return Buffer.from(a).equals(Buffer.from(b));
}

function startsWithMagic(bytes: Uint8Array): boolean {
	return new TextDecoder().decode(bytes.subarray(0, 4)) === ENCRYPTION_MAGIC;
}

async function intakePdf(): Promise<{ documentId: string; fileId: string }> {
	const result = await intakeFile(ctx, {
		data: pdf,
		filename: "Payslip.pdf",
		mime: "application/pdf",
		createdById: userId,
	});
	if (isDuplicate(result)) throw new Error("unexpected duplicate");
	return result;
}

async function fileRow(fileId: string) {
	const [row] = await db
		.select()
		.from(documentFile)
		.where(eq(documentFile.id, fileId));
	if (!row) throw new Error("file not found");
	return row;
}

describe("setSensitive", () => {
	test("encrypts on the way in and decrypts on the way out", async () => {
		const { documentId, fileId } = await intakePdf();
		const before = await fileRow(fileId);
		expect(before.encrypted).toBe(false);
		expect(startsWithMagic(await bytesOnDisk(before.storageKey))).toBe(false);

		const result = await setSensitive(ctx, documentId, true);
		expect(result).toEqual({ documentId, sensitive: true, rekeyed: 1 });

		const encrypted = await fileRow(fileId);
		expect(encrypted.encrypted).toBe(true);
		const stored = await bytesOnDisk(encrypted.storageKey);
		expect(startsWithMagic(stored)).toBe(true);
		expect(sameBytes(stored, pdf)).toBe(false);

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, documentId));
		expect(doc?.sensitive).toBe(true);

		// Reading back through the right driver returns the original bytes.
		const blob = await storageForFile(ctx, true).get(encrypted.storageKey);
		expect(sameBytes(new Uint8Array(await blob.arrayBuffer()), pdf)).toBe(true);

		// And back to plaintext.
		expect(await setSensitive(ctx, documentId, false)).toEqual({
			documentId,
			sensitive: false,
			rekeyed: 1,
		});
		const plain = await fileRow(fileId);
		expect(plain.encrypted).toBe(false);
		expect(sameBytes(await bytesOnDisk(plain.storageKey), pdf)).toBe(true);
	});

	test("re-keys the thumbnail alongside the file", async () => {
		const { documentId, fileId } = await intakePdf();
		const png = new TextEncoder().encode("fake-png-bytes");
		const key = thumbnailKey(documentId, fileId);
		await ctx.storage.put(key, png);
		await db
			.update(documentFile)
			.set({ thumbnailKey: key })
			.where(eq(documentFile.id, fileId));

		await setSensitive(ctx, documentId, true);
		expect(startsWithMagic(await bytesOnDisk(key))).toBe(true);
		expect(
			sameBytes(
				new Uint8Array(
					await (await storageForFile(ctx, true).get(key)).arrayBuffer(),
				),
				png,
			),
		).toBe(true);

		await setSensitive(ctx, documentId, false);
		expect(sameBytes(await bytesOnDisk(key), png)).toBe(true);
	});

	test("is idempotent: a second call rewrites nothing", async () => {
		const { documentId } = await intakePdf();
		expect((await setSensitive(ctx, documentId, true)).rekeyed).toBe(1);
		expect((await setSensitive(ctx, documentId, true)).rekeyed).toBe(0);
	});

	test("a missing object does not block the flag", async () => {
		const { documentId, fileId } = await intakePdf();
		const row = await fileRow(fileId);
		await ctx.storage.delete(row.storageKey);

		await setSensitive(ctx, documentId, true);
		expect((await fileRow(fileId)).encrypted).toBe(true);
	});
});

describe("intakeFile with defaults.sensitive", () => {
	test("writes straight through the encrypted driver", async () => {
		const result = await intakeFile(ctx, {
			data: pdf,
			filename: "Medical report.pdf",
			mime: "application/pdf",
			createdById: userId,
			defaults: { sensitive: true },
		});
		if (isDuplicate(result)) throw new Error("unexpected duplicate");

		const row = await fileRow(result.fileId);
		expect(row.encrypted).toBe(true);
		// The plaintext never touched the disk.
		expect(startsWithMagic(await bytesOnDisk(row.storageKey))).toBe(true);
		// `size` stays the plaintext size, as everywhere else.
		expect(row.size).toBe(pdf.byteLength);

		const [doc] = await db
			.select()
			.from(document)
			.where(eq(document.id, result.documentId));
		expect(doc?.sensitive).toBe(true);
	});
});

describe("sweepSensitiveShareLinks", () => {
	async function seedDocument(
		options: { sensitive?: boolean; trashed?: boolean } = {},
	): Promise<string> {
		const rows = await db
			.insert(document)
			.values({
				title: "Seeded",
				status: "active",
				createdById: userId,
				sensitive: options.sensitive ?? false,
				deletedAt: options.trashed ? new Date() : null,
			})
			.returning({ id: document.id });
		return rows[0]?.id ?? "";
	}

	async function seedDossier(documentIds: string[]): Promise<string> {
		const rows = await db
			.insert(dossier)
			.values({ name: `Case ${createId("")}` })
			.returning({ id: dossier.id });
		const id = rows[0]?.id ?? "";
		if (documentIds.length > 0) {
			await db
				.insert(documentDossier)
				.values(
					documentIds.map((documentId) => ({ documentId, dossierId: id })),
				);
		}
		return id;
	}

	async function seedLink(
		target: { documentId?: string; dossierId?: string },
		revoked?: { at: Date; reason: "manual" },
	): Promise<string> {
		const rows = await db
			.insert(shareLink)
			.values({
				token: createId("tok"),
				documentId: target.documentId ?? null,
				dossierId: target.dossierId ?? null,
				createdById: userId,
				revokedAt: revoked?.at ?? null,
				revokedReason: revoked?.reason ?? null,
			})
			.returning({ id: shareLink.id });
		return rows[0]?.id ?? "";
	}

	async function linkRow(id: string) {
		const [row] = await db.select().from(shareLink).where(eq(shareLink.id, id));
		if (!row) throw new Error("share link not found");
		return row;
	}

	test("closes the windows the write-time guards missed", async () => {
		const secret = await seedDocument({ sensitive: true });
		const plain = await seedDocument();
		const onSecret = await seedLink({ documentId: secret });
		const onPlain = await seedLink({ documentId: plain });
		const onDossier = await seedLink({
			dossierId: await seedDossier([secret, plain]),
		});
		const onPlainDossier = await seedLink({
			dossierId: await seedDossier([plain]),
		});

		expect(await sweepSensitiveShareLinks(db)).toBe(2);

		expect((await linkRow(onSecret)).revokedReason).toBe("sensitive");
		expect((await linkRow(onDossier)).revokedReason).toBe("sensitive");
		// Nothing sensitive behind them: they keep serving.
		expect((await linkRow(onPlain)).revokedAt).toBeNull();
		expect((await linkRow(onPlainDossier)).revokedAt).toBeNull();
	});

	test("a dossier whose only sensitive document is trashed keeps its links", async () => {
		const dropped = await seedDocument({ sensitive: true, trashed: true });
		const id = await seedLink({ dossierId: await seedDossier([dropped]) });

		expect(await sweepSensitiveShareLinks(db)).toBe(0);
		expect((await linkRow(id)).revokedAt).toBeNull();
	});

	test("is idempotent and leaves an earlier revocation alone", async () => {
		const secret = await seedDocument({ sensitive: true });
		const revokedAt = new Date("2026-01-01T00:00:00Z");
		const manual = await seedLink(
			{ documentId: secret },
			{ at: revokedAt, reason: "manual" },
		);
		const fresh = await seedLink({ documentId: secret });

		expect(await sweepSensitiveShareLinks(db)).toBe(1);
		// A second pass on a store already in order revokes nothing.
		expect(await sweepSensitiveShareLinks(db)).toBe(0);

		const kept = await linkRow(manual);
		expect(kept.revokedReason).toBe("manual");
		expect(kept.revokedAt?.getTime()).toBe(revokedAt.getTime());
		expect((await linkRow(fresh)).revokedReason).toBe("sensitive");
	});
});

describe("without a master key", () => {
	test("the flag is persisted but nothing is encrypted", async () => {
		const plainIngestion = await createTestIngestion(db, { encryption: false });
		try {
			const result = await intakeFile(plainIngestion.ctx, {
				data: pdf,
				filename: "Plain.pdf",
				mime: "application/pdf",
				createdById: userId,
			});
			if (isDuplicate(result)) throw new Error("unexpected duplicate");

			const outcome = await setSensitive(
				plainIngestion.ctx,
				result.documentId,
				true,
			);
			expect(outcome.sensitive).toBe(true);
			expect(outcome.rekeyed).toBe(0);
			// `encrypted` keeps telling the truth about the bytes on disk.
			expect((await fileRow(result.fileId)).encrypted).toBe(false);
		} finally {
			await plainIngestion.cleanup();
		}
	});
});
