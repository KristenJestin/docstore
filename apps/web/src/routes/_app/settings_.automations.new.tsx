import { createFileRoute } from "@tanstack/react-router";

import { RuleEditor } from "@/components/rules/rule-editor";

/**
 * The editor carries its own `PageHeader`: it sits next to the settings shell
 * (`settings_`), not inside it, so the page never stacks two headers.
 */
export const Route = createFileRoute("/_app/settings_/automations/new")({
	component: NewAutomationPage,
});

function NewAutomationPage() {
	return <RuleEditor />;
}
