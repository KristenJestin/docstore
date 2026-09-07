import type { Db } from "@docstore/db";
import { party } from "@docstore/db/schema/party";
import type { Party } from "@docstore/shared/party";
import type { StorageDriver } from "@docstore/storage";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import sharp from "sharp";

/** Size of the longest side after resizing. */
export const LOGO_SIZE = 256;

/** Maximum size accepted as input. */
export const MAX_LOGO_BYTES = 1024 * 1024;

const RASTER_MIMES = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/webp": "webp",
} as const;

const SVG_MIME = "image/svg+xml";

export const ALLOWED_LOGO_MIMES = [
	...Object.keys(RASTER_MIMES),
	SVG_MIME,
] as const;

/** `parties/<id>/logo.<ext>` */
export function partyLogoKey(partyId: string, ext: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(partyId)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Invalid Party identifier: ${partyId}.`,
		});
	}
	return `parties/${partyId}/logo.${ext}`;
}

/** MIME type inferred from the extension of a logo key. */
export function logoMimeFromKey(key: string): string {
	return key.endsWith(".svg") ? SVG_MIME : "image/png";
}

async function requirePartyRow(db: Db, id: string): Promise<Party> {
	const rows = await db.select().from(party).where(eq(party.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${id}" not found.`,
		});
	}
	return row;
}

/**
 * Resizes a raster image to a 256 px PNG (without enlarging).
 * SVG files are kept as-is.
 */
async function normalizeLogo(
	bytes: Uint8Array,
	mime: string,
): Promise<{ data: Uint8Array; ext: string }> {
	if (mime === SVG_MIME) {
		return { data: bytes, ext: "svg" };
	}
	const resized = await sharp(bytes)
		.resize(LOGO_SIZE, LOGO_SIZE, { fit: "inside", withoutEnlargement: true })
		.png()
		.toBuffer();
	return { data: new Uint8Array(resized), ext: "png" };
}

async function storeLogo(
	db: Db,
	storage: StorageDriver,
	current: Party,
	bytes: Uint8Array,
	mime: string,
): Promise<Party> {
	const { data, ext } = await normalizeLogo(bytes, mime);
	const key = partyLogoKey(current.id, ext);
	await storage.put(key, data);

	// The extension can change (svg → png): clean up the old object.
	if (current.logoKey && current.logoKey !== key) {
		await storage.delete(current.logoKey).catch(() => undefined);
	}

	const rows = await db
		.update(party)
		.set({ logoKey: key })
		.where(eq(party.id, current.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${current.id}" not found.`,
		});
	}
	return row;
}

export interface UploadPartyLogoInput {
	id: string;
	filename: string;
	mime: string;
	bytes: Uint8Array;
}

export async function uploadPartyLogo(
	db: Db,
	storage: StorageDriver,
	input: UploadPartyLogoInput,
): Promise<Party> {
	const mime = input.mime.toLowerCase().split(";")[0]?.trim() ?? "";
	if (!(ALLOWED_LOGO_MIMES as readonly string[]).includes(mime)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Unsupported logo format: ${input.mime || "unknown"} (png, jpg, webp or svg expected).`,
		});
	}
	if (input.bytes.byteLength > MAX_LOGO_BYTES) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The logo must not exceed 1 MB.",
		});
	}

	const current = await requirePartyRow(db, input.id);
	return storeLogo(db, storage, current, input.bytes, mime);
}

/** First domain declared in the Party identifiers. */
export function primaryDomain(row: Party): string | null {
	const domain = row.identifiers.domain?.[0]?.trim();
	if (!domain) {
		return null;
	}
	return domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

/** Sources tried in order to fetch a favicon. */
export function logoCandidateUrls(domain: string): string[] {
	return [
		`https://${domain}/favicon.ico`,
		`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
	];
}

export type LogoFetcher = (
	url: string,
) => Promise<{ bytes: Uint8Array; mime: string } | null>;

/** Default network fetch: silently ignores failures. */
export const defaultLogoFetcher: LogoFetcher = async (url) => {
	try {
		const response = await fetch(url, { redirect: "follow" });
		if (!response.ok) {
			return null;
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) {
			return null;
		}
		return {
			bytes: new Uint8Array(buffer),
			mime: response.headers.get("content-type") ?? "",
		};
	} catch {
		return null;
	}
};

/**
 * Tries to fetch the logo from the first known domain of the Party
 * (site favicon, then the Google favicon service).
 */
export async function fetchPartyLogo(
	db: Db,
	storage: StorageDriver,
	id: string,
	fetcher: LogoFetcher = defaultLogoFetcher,
): Promise<Party> {
	const current = await requirePartyRow(db, id);
	const domain = primaryDomain(current);
	if (!domain) {
		throw new ORPCError("NOT_FOUND", {
			message: "No domain is set in the identifiers.",
		});
	}

	for (const url of logoCandidateUrls(domain)) {
		const fetched = await fetcher(url);
		if (!fetched) {
			continue;
		}
		try {
			// `sharp` accepts ico/png/jpeg/webp; non-image content fails here.
			return await storeLogo(db, storage, current, fetched.bytes, "image/png");
		} catch {
			// Next source.
		}
	}

	throw new ORPCError("NOT_FOUND", {
		message: `No logo found for the domain "${domain}".`,
	});
}

export async function removePartyLogo(
	db: Db,
	storage: StorageDriver,
	id: string,
): Promise<Party> {
	const current = await requirePartyRow(db, id);
	if (current.logoKey) {
		await storage.delete(current.logoKey).catch(() => undefined);
	}
	const rows = await db
		.update(party)
		.set({ logoKey: null })
		.where(eq(party.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${id}" not found.`,
		});
	}
	return row;
}

/** Metadata needed to serve the logo over HTTP. */
export async function getPartyLogoForDownload(
	db: Db,
	id: string,
): Promise<{ id: string; logoKey: string; mime: string }> {
	const rows = await db
		.select({ id: party.id, logoKey: party.logoKey })
		.from(party)
		.where(eq(party.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Party "${id}" not found.`,
		});
	}
	if (!row.logoKey) {
		throw new ORPCError("NOT_FOUND", {
			message: "This Party has no logo.",
		});
	}
	return {
		id: row.id,
		logoKey: row.logoKey,
		mime: logoMimeFromKey(row.logoKey),
	};
}
