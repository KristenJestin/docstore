import { env } from "@docstore/env/web";

/**
 * URLs of the server file routes (`apps/server/src/files.ts`).
 *
 * Those routes do not go through oRPC: a plain `GET` is what makes `<img src>`,
 * `<iframe src>` and native downloads work. The session cookie is sent
 * automatically (same site, only the port differs), so no `crossOrigin` is
 * needed.
 *
 * With the single-origin setup (`VITE_SERVER_URL=/`, a reverse proxy in front —
 * Caddy in production, the Vite dev server proxy in development) the prefix
 * normalizes to the empty string and every helper below returns a root-relative
 * URL. That is deliberate: the browser resolves it against the page origin, and
 * the SSR pass emits markup that stays correct whatever host served it.
 */
const SERVER_URL = env.VITE_SERVER_URL.replace(/\/+$/, "");

/** Original file. `inline` opens the PDF in a frame instead of downloading it. */
export function fileDownloadUrl(
	fileId: string,
	options?: { inline?: boolean },
): string {
	return `${SERVER_URL}/files/${fileId}/download${
		options?.inline ? "?disposition=inline" : ""
	}`;
}

/** PNG thumbnail of a file. */
export function fileThumbnailUrl(fileId: string): string {
	return `${SERVER_URL}/files/${fileId}/thumbnail`;
}

/**
 * `POST /api/export` — the ZIP is streamed by a plain HTTP route rather than
 * an oRPC procedure, so the browser can download it natively.
 */
export function exportApiUrl(): string {
	return `${SERVER_URL}/api/export`;
}

/**
 * Party logo (manual upload or fetched favicon). `version` is appended as a
 * cache buster so a freshly fetched logo replaces the previous one right away.
 */
export function partyLogoUrl(partyId: string, version?: string | null): string {
	const url = `${SERVER_URL}/api/parties/${partyId}/logo`;
	return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

/** Key produced by `thumbnailKey()` from `@docstore/storage`. */
const THUMBNAIL_KEY_PATTERN = /^thumbnails\/[^/]+\/([^/]+)\.png$/;

/**
 * `thumbnails/doc_x/fil_y.png` → `fil_y`.
 *
 * Workaround: `document.list` exposes the thumbnail storage key but not the id
 * of the file carrying it, while the HTTP route expects a `fileId`. To be
 * replaced by a dedicated API field.
 */
export function fileIdFromThumbnailKey(
	thumbnailKey: string | null | undefined,
): string | null {
	if (!thumbnailKey) {
		return null;
	}
	return THUMBNAIL_KEY_PATTERN.exec(thumbnailKey)?.[1] ?? null;
}
