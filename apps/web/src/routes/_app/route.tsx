import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { PageSkeleton } from "@/components/page-skeletons";
import { authClient } from "@/lib/auth-client";

/**
 * Protected layout: every page under `_app` requires a session.
 *
 * The session check is a round trip, and the owner used to stare at a spinner
 * on an empty page while it ran. The shell does not depend on it, so it is
 * drawn straight away — brand, navigation, top bar — with placeholders where
 * the data goes. `/login` only comes into play once `getSession` has actually
 * come back without a session.
 */
export const Route = createFileRoute("/_app")({
	ssr: false,
	component: AppLayout,
	// No delay before the placeholders, but at least a fifth of a second on
	// screen: a session answering in 40 ms must not flash a frame at anybody.
	pendingMs: 0,
	pendingMinMs: 200,
	pendingComponent: AppLayoutPending,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({ to: "/login" });
		}
		return { session };
	},
});

function AppLayout() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}

/** Same shell, no session yet: nothing moves when the real one takes over. */
function AppLayoutPending() {
	return (
		<AppShell pending>
			<PageSkeleton />
		</AppShell>
	);
}
