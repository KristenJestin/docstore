import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old address of the rule editor, kept as a redirect. */
export const Route = createFileRoute("/_app/rules/new")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/automations/new", replace: true });
	},
});
