import { createFileRoute, redirect } from "@tanstack/react-router";

/** The rules became the "Automations" tab of the settings (iteration 8). */
export const Route = createFileRoute("/_app/rules/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/automations", replace: true });
	},
});
