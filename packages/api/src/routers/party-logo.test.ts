import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import { FsStorageDriver, type StorageDriver } from "@docstore/storage";
import { createRouterClient, type RouterClient } from "@orpc/server";
import sharp from "sharp";
import {
	fetchPartyLogo,
	getPartyLogoForDownload,
	type LogoFetcher,
	logoCandidateUrls,
	logoMimeFromKey,
	partyLogoKey,
} from "../services/party-logo.service";
import {
	createTestContext,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";
import { appRouter } from "./index";

let db: TestDb;
let owner: TestUser;
let rootDir: string;
let storage: StorageDriver;
let client: RouterClient<typeof appRouter>;

/** Square PNG of `size` px, generated on the fly by sharp. */
async function makePng(size: number): Promise<Uint8Array> {
	const buffer = await sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background: { r: 200, g: 30, b: 30, alpha: 1 },
		},
	})
		.png()
		.toBuffer();
	return new Uint8Array(buffer);
}

function toFile(bytes: Uint8Array, name: string, type: string): File {
	// `Uint8Array` is not recognized as a `BlobPart` by the Bun typings.
	return new File([bytes.buffer as ArrayBuffer], name, { type });
}

beforeAll(async () => {
	db = await createTestDb();
	rootDir = await mkdtemp(join(tmpdir(), "docstore-logo-test-"));
	storage = new FsStorageDriver({ rootDir: join(rootDir, "storage") });
});

afterAll(async () => {
	await db.$client.end();
	await rm(rootDir, { recursive: true, force: true });
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	const context = createTestContext(db, owner);
	// Only the pipeline storage is needed by the logo procedures.
	const ingestion = { ctx: { storage } } as unknown as IngestionBinding;
	client = createRouterClient(appRouter, {
		context: { ...context, ingestion },
	});
});

describe("partyLogoKey / logoMimeFromKey", () => {
	test("builds a safe key and infers the MIME type", () => {
		expect(partyLogoKey("prt_abc", "png")).toBe("parties/prt_abc/logo.png");
		expect(logoMimeFromKey("parties/prt_abc/logo.svg")).toBe("image/svg+xml");
		expect(logoMimeFromKey("parties/prt_abc/logo.png")).toBe("image/png");
	});

	test("the favicon sources are tried in order", () => {
		expect(logoCandidateUrls("edf.fr")).toEqual([
			"https://edf.fr/favicon.ico",
			"https://www.google.com/s2/favicons?domain=edf.fr&sz=128",
		]);
	});
});

describe("party.uploadLogo", () => {
	test("resizes a PNG to 256 px and stores the key", async () => {
		const party = await client.party.create({ type: "company", name: "EDF" });
		const png = await makePng(512);

		const updated = await client.party.uploadLogo({
			id: party.id,
			file: toFile(png, "logo.png", "image/png"),
		});

		expect(updated.logoKey).toBe(`parties/${party.id}/logo.png`);
		expect(await storage.exists(updated.logoKey ?? "")).toBe(true);

		const stored = await storage.get(updated.logoKey ?? "");
		const metadata = await sharp(
			new Uint8Array(await stored.arrayBuffer()),
		).metadata();
		expect(metadata.width).toBe(256);
		expect(metadata.height).toBe(256);
		expect(metadata.format).toBe("png");
	});

	test("does not upscale an image smaller than 256 px", async () => {
		const party = await client.party.create({
			type: "company",
			name: "Orange",
		});
		const png = await makePng(64);

		const updated = await client.party.uploadLogo({
			id: party.id,
			file: toFile(png, "logo.png", "image/png"),
		});
		const stored = await storage.get(updated.logoKey ?? "");
		const metadata = await sharp(
			new Uint8Array(await stored.arrayBuffer()),
		).metadata();
		expect(metadata.width).toBe(64);
	});

	test("keeps an SVG as-is", async () => {
		const party = await client.party.create({ type: "company", name: "Free" });
		const svg = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
		);

		const updated = await client.party.uploadLogo({
			id: party.id,
			file: toFile(svg, "logo.svg", "image/svg+xml"),
		});
		expect(updated.logoKey).toBe(`parties/${party.id}/logo.svg`);

		const stored = await storage.get(updated.logoKey ?? "");
		expect(await stored.text()).toContain("<svg");
	});

	test("rejects an unsupported format", async () => {
		const party = await client.party.create({ type: "company", name: "Sosh" });
		await expectOrpcError(
			client.party.uploadLogo({
				id: party.id,
				file: toFile(new Uint8Array([1, 2, 3]), "logo.gif", "image/gif"),
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects a file larger than 1 MB", async () => {
		const party = await client.party.create({ type: "company", name: "SFR" });
		const tooBig = new Uint8Array(1024 * 1024 + 1);

		await expectOrpcError(
			client.party.uploadLogo({
				id: party.id,
				file: toFile(tooBig, "logo.png", "image/png"),
			}),
			"BAD_REQUEST",
		);
	});

	test("rejects an unknown Party", async () => {
		const png = await makePng(32);
		await expectOrpcError(
			client.party.uploadLogo({
				id: "prt_unknown",
				file: toFile(png, "logo.png", "image/png"),
			}),
			"NOT_FOUND",
		);
	});
});

describe("party.removeLogo", () => {
	test("deletes the object and resets logoKey to null", async () => {
		const party = await client.party.create({ type: "company", name: "EDF" });
		const uploaded = await client.party.uploadLogo({
			id: party.id,
			file: toFile(await makePng(128), "logo.png", "image/png"),
		});
		const key = uploaded.logoKey ?? "";

		const removed = await client.party.removeLogo({ id: party.id });
		expect(removed.logoKey).toBeNull();
		expect(await storage.exists(key)).toBe(false);
	});
});

describe("service — logo served over HTTP", () => {
	test("getPartyLogoForDownload returns the key and the MIME type", async () => {
		const party = await client.party.create({ type: "company", name: "EDF" });
		await expectOrpcError(getPartyLogoForDownload(db, party.id), "NOT_FOUND");

		await client.party.uploadLogo({
			id: party.id,
			file: toFile(await makePng(128), "logo.png", "image/png"),
		});

		const logo = await getPartyLogoForDownload(db, party.id);
		expect(logo.logoKey).toBe(`parties/${party.id}/logo.png`);
		expect(logo.mime).toBe("image/png");

		await expectOrpcError(
			getPartyLogoForDownload(db, "prt_unknown"),
			"NOT_FOUND",
		);
	});
});

describe("fetchPartyLogo", () => {
	test("NOT_FOUND when no domain is set", async () => {
		const party = await client.party.create({ type: "company", name: "EDF" });
		await expectOrpcError(
			fetchPartyLogo(db, storage, party.id, async () => null),
			"NOT_FOUND",
		);
	});

	test("falls back to the favicon service when the site does not answer", async () => {
		const party = await client.party.create({
			type: "company",
			name: "EDF",
			identifiers: { domain: ["edf.fr"] },
		});
		const png = await makePng(400);
		const attempted: string[] = [];
		const fetcher: LogoFetcher = async (url) => {
			attempted.push(url);
			if (url.endsWith("favicon.ico")) {
				return null;
			}
			return { bytes: png, mime: "image/png" };
		};

		const updated = await fetchPartyLogo(db, storage, party.id, fetcher);
		expect(attempted).toEqual(logoCandidateUrls("edf.fr"));
		expect(updated.logoKey).toBe(`parties/${party.id}/logo.png`);

		const stored = await storage.get(updated.logoKey ?? "");
		const metadata = await sharp(
			new Uint8Array(await stored.arrayBuffer()),
		).metadata();
		expect(metadata.width).toBe(256);
	});

	test("NOT_FOUND when no source returns a usable image", async () => {
		const party = await client.party.create({
			type: "company",
			name: "EDF",
			identifiers: { domain: ["edf.fr"] },
		});
		const fetcher: LogoFetcher = async () => ({
			bytes: new TextEncoder().encode("not an image"),
			mime: "image/png",
		});

		await expectOrpcError(
			fetchPartyLogo(db, storage, party.id, fetcher),
			"NOT_FOUND",
		);
	});
});
