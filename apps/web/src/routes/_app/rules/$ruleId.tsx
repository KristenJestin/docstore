import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old address of a rule, kept as a redirect. */
export const Route = createFileRoute("/_app/rules/$ruleId")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/settings/automations/$ruleId",
			params: { ruleId: params.ruleId },
			replace: true,
		});
	},
});
