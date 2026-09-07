import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The standalone extraction rules are gone: a rule now only exists inside a
 * layout of a document type (SPEC §9), so the old addresses land on the types.
 */
export const Route = createFileRoute("/_app/rules/extraction/")({
	beforeLoad: () => {
		throw redirect({ to: "/types", search: {}, replace: true });
	},
});
