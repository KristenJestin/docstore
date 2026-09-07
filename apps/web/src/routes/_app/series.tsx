import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Series became the recurring document types (SPEC §9): the old address keeps
 * working and lands on the "Recurring" tab of `/types`.
 */
export const Route = createFileRoute("/_app/series")({
	beforeLoad: () => {
		throw redirect({ to: "/types", search: { recurring: true } });
	},
});
