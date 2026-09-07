import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		/**
		 * Base of the API, frozen into the bundle at build time.
		 *
		 * `"/"` means "same origin": the API is reachable under the very paths the
		 * page is served from, because a reverse proxy sits in front (Caddy in
		 * production, the Vite dev server proxy in development). The browser then
		 * derives the origin from `window.location`, and the SSR pass falls back to
		 * `SERVER_URL` (see `apps/web/src/utils/orpc.ts`).
		 */
		VITE_SERVER_URL: z.union([z.url(), z.literal("/")]),
	},
	runtimeEnv: (
		import.meta as ImportMeta & { env: Record<string, string | undefined> }
	).env,
	emptyStringAsUndefined: true,
});
