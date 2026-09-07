import { env } from "@docstore/env/web";

import { resolvePublicPageUrl } from "./public-link-url";

/** Base URL of the API, where the public `/api/s/:token` endpoints are served. */
const SERVER_URL = env.VITE_SERVER_URL.replace(/\/+$/, "");

/**
 * Public page handed to the visitor, as built by the API from `PUBLIC_URL`.
 *
 * `link.url` is authoritative — it is the URL a third party will type in a
 * browser. `resolvePublicPageUrl` only rewrites it onto the current origin in
 * the split-port development setup (see `lib/public-link-url.ts`).
 */
export function publicSharePageUrl(link: {
	token: string;
	url: string;
}): string {
	return resolvePublicPageUrl(link.url, `/s/${link.token}`);
}

/**
 * `GET /api/s/:token` — metadata of the share (plain HTTP, no oRPC, no
 * session). The server namespaces the public token routes under `/api` so they
 * never collide with the `/s/:token` page of this application.
 */
export function publicShareApiUrl(token: string): string {
	return `${SERVER_URL}/api/s/${token}`;
}

export interface ShareFileUrlOptions {
	/** Access token returned by `POST /api/s/:token/unlock`. */
	access?: string | null;
	/** PNG preview instead of the original file. */
	thumbnail?: boolean;
	/** Opens the file in a tab instead of downloading it. */
	inline?: boolean;
}

/** `/api/s/:token/files/:fileId/download|thumbnail`, with its query string. */
export function shareFileUrl(
	token: string,
	fileId: string,
	{ access, thumbnail = false, inline = false }: ShareFileUrlOptions = {},
): string {
	const params = new URLSearchParams();
	if (access) {
		params.set("access", access);
	}
	if (!thumbnail && inline) {
		params.set("disposition", "inline");
	}
	const query = params.toString();
	return `${publicShareApiUrl(token)}/files/${fileId}/${
		thumbnail ? "thumbnail" : "download"
	}${query ? `?${query}` : ""}`;
}
