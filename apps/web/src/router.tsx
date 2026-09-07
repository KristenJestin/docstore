import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { PageSkeleton } from "./components/page-skeletons";
import { routeTree } from "./routeTree.gen";
import { createQueryClient, orpc } from "./utils/orpc";

export const getRouter = () => {
	const queryClient = createQueryClient();

	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		// Hovering or focusing a link loads the route and its first query, so
		// the click itself lands on data that is already in the cache: the
		// previous page simply stays until the next one is ready.
		defaultPreload: "intent",
		// Freshness is React Query's business (60 s in `createQueryClient`), so
		// the router never caches loader results on top of it.
		defaultPreloadStaleTime: 0,
		context: { orpc, queryClient },
		// A route that does have to wait shows its shape immediately, and keeps
		// it long enough not to read as a flicker.
		defaultPendingMs: 0,
		defaultPendingMinMs: 200,
		defaultPendingComponent: () => <PageSkeleton />,
		defaultNotFoundComponent: () => <div>Not Found</div>,
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient,
	});

	return router;
};

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
