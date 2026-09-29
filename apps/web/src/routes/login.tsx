import { createFileRoute } from "@tanstack/react-router";

import SignInForm from "@/components/sign-in-form";
import { type AuthSearch, authSearchSchema } from "@/lib/auth-redirect";

/**
 * Sign-in page (issue #16, D16-03). Sign-up has its own URL, `/signup`; the
 * two pages link to each other and carry `?redirect=` along.
 */
export const Route = createFileRoute("/login")({
	validateSearch: (search): AuthSearch => authSearchSchema.parse(search),
	component: RouteComponent,
});

function RouteComponent() {
	const { redirect } = Route.useSearch();
	return <SignInForm redirect={redirect} />;
}
