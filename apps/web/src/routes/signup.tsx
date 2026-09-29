import { createFileRoute } from "@tanstack/react-router";

import SignUpForm from "@/components/sign-up-form";
import { type AuthSearch, authSearchSchema } from "@/lib/auth-redirect";

/**
 * Sign-up page (issue #16, D16-03). Whether an account can be created is the
 * server's answer (`settings.signUpStatus`): open while the installation has
 * no account yet, then only when a member turned "Allow sign-up" on.
 */
export const Route = createFileRoute("/signup")({
	ssr: false,
	validateSearch: (search): AuthSearch => authSearchSchema.parse(search),
	component: RouteComponent,
});

function RouteComponent() {
	const { redirect } = Route.useSearch();
	return <SignUpForm redirect={redirect} />;
}
