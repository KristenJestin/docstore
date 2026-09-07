import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/settings` has no content of its own: it opens the first tab. */
export const Route = createFileRoute("/_app/settings/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/general" });
	},
});
