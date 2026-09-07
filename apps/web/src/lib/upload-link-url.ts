import { env } from "@docstore/env/web";

import { resolvePublicPageUrl } from "./public-link-url";

/** Base URL of the API, where the public `/api/u/:token` endpoints are served. */
const SERVER_URL = env.VITE_SERVER_URL.replace(/\/+$/, "");

/**
 * Public page handed to the depositor, as built by the API from `PUBLIC_URL`.
 *
 * `link.url` is authoritative; `resolvePublicPageUrl` only rewrites it onto the
 * current origin in the split-port development setup (see
 * `lib/public-link-url.ts`).
 */
export function publicUploadPageUrl(link: {
	token: string;
	url: string;
}): string {
	return resolvePublicPageUrl(link.url, `/u/${link.token}`);
}

/**
 * `GET`/`POST` endpoint of a public upload link (plain HTTP, no oRPC). The
 * server namespaces the public token routes under `/api` so they never collide
 * with the `/u/:token` page of this application behind the reverse proxy.
 */
export function publicUploadApiUrl(token: string): string {
	return `${SERVER_URL}/api/u/${token}`;
}
