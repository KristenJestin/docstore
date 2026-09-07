import type { AppRouter } from "@docstore/api/routers/index";
import { env } from "@docstore/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { QueryKey } from "@tanstack/react-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiErrorMessage } from "@/lib/api-error";

/**
 * Reference data that changes only when the user edits it on a settings
 * screen. Every mutation still invalidates it, so a short window of reuse
 * costs nothing and spares the API a request per navigation.
 */
const STATIC_STALE_TIME = 30 * 1000;

/**
 * `true` for the reference lists above. oRPC query keys are
 * `[path, { input, type }]`, so the procedure path is the first entry.
 */
function isStaticReference(queryKey: QueryKey) {
	const path = queryKey[0];
	if (!Array.isArray(path)) {
		return false;
	}
	const [domain, procedure] = path as string[];
	if (domain === "category" || domain === "tag" || domain === "customField") {
		return true;
	}
	// Only the list: a type detail carries counters that move with ingestion.
	return domain === "documentType" && procedure === "list";
}

/**
 * Every query is stale as soon as it lands, so a page reached by navigation
 * refetches on mount, and every successful mutation invalidates the whole
 * cache: active queries refetch right away, the rest on their next mount.
 * That is what keeps the sidebar counters, the reminder bell and the detail
 * headers in sync without a manual `invalidateQueries` at each call site.
 */
export function createQueryClient() {
	const queryClient: QueryClient = new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				const { message, description } = apiErrorMessage(
					error,
					"Something went wrong while loading this data.",
				);
				toast.error(message, {
					description,
					action: {
						label: "Retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
		mutationCache: new MutationCache({
			// Not awaited: invalidation marks the cache synchronously, so a form
			// that navigates on save already lands on fresh data, while the
			// refetches themselves stay off the mutation's pending state.
			onSuccess: () => {
				void queryClient.invalidateQueries();
			},
		}),
		defaultOptions: {
			queries: {
				staleTime: (query) =>
					isStaticReference(query.queryKey) ? STATIC_STALE_TIME : 0,
				refetchOnWindowFocus: true,
				refetchOnReconnect: true,
			},
		},
	});

	return queryClient;
}

/**
 * Idle cadence of the live counters (sidebar badges, reminder bell). Mutations
 * already refresh them; this is what catches the changes coming from outside
 * the tab — IMAP intake, scheduled rules, another device.
 */
export const COUNTER_POLL_MS = 30_000;

/** Polling options shared by every live counter. Paused in the background. */
export const counterPollOptions = {
	refetchInterval: COUNTER_POLL_MS,
	refetchIntervalInBackground: false,
} as const;

/**
 * Absolute base of the API from the configured `VITE_SERVER_URL`.
 *
 * Three shapes are supported: an absolute URL (`http://api:3000`, used by the
 * Docker web container for its SSR calls), a path (`/api`), and the bare `"/"`
 * of the single-origin setup — which normalizes to the empty string and must
 * therefore be resolved against the current origin rather than returned as is,
 * since `RPCLink` and `new URL()` both need an absolute base.
 */
function getServerUrl(url: string) {
	const processEnv = (
		globalThis as {
			process?: { env?: Record<string, string | undefined> };
		}
	).process?.env;
	if (typeof window === "undefined" && processEnv?.SERVER_URL) {
		return processEnv.SERVER_URL.replace(/\/+$/, "");
	}

	const normalized = url.replace(/\/+$/, "");

	if (normalized !== "" && !normalized.startsWith("/")) {
		return normalized;
	}

	if (typeof window !== "undefined") {
		return `${window.location.origin}${normalized}`;
	}

	const vercelUrl =
		processEnv?.VERCEL_ENV === "production"
			? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
			: (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
	if (vercelUrl) {
		const origin = vercelUrl.startsWith("http")
			? vercelUrl
			: `https://${vercelUrl}`;
		return `${origin}${normalized}`;
	}

	return `http://localhost:3000${normalized}`;
}
const link = new RPCLink({
	url: `${getServerUrl(env.VITE_SERVER_URL)}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

const getORPCClient = () => {
	return createORPCClient(link) as RouterClient<AppRouter>;
};

export const client: RouterClient<AppRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
