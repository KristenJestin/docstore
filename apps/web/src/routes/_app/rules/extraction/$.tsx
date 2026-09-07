import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/rules/extraction/$")({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/_app/rules/extraction/$"!</div>;
}
