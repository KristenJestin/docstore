import {
	SIGN_UP_CLOSED_CODE,
	type SignUpState,
} from "@docstore/shared/settings";
import { Button, buttonVariants } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { redirectSearch, safeRedirect } from "@/lib/auth-redirect";
import { orpc } from "@/utils/orpc";

import { AuthCard } from "./auth-card";
import { FormField } from "./form-field";
import Loader from "./loader";

const signUpSchema = z.object({
	name: z.string().trim().min(2, "Name must be at least 2 characters."),
	email: z.email("Enter a valid email address."),
	password: z.string().min(8, "Password must be at least 8 characters."),
});

/** What the card says above the form, by reason sign-up is open. */
const OPEN_DESCRIPTIONS: Record<Exclude<SignUpState, "closed">, string> = {
	"first-user": "Create the first account of this installation.",
	allowed: "One account per household member.",
};

/**
 * `/signup` (issue #16). The server says whether an account can be created
 * (`settings.signUpStatus`) and refuses the request itself when it cannot
 * (D16-02); the page only explains it.
 */
export default function SignUpForm({ redirect }: { redirect?: string }) {
	const navigate = useNavigate();
	const { isPending } = authClient.useSession();
	const fieldId = useId();
	const status = useQuery(
		orpc.settings.signUpStatus.queryOptions({ input: {} }),
	);

	const signInLink = (
		<Link
			to="/login"
			search={redirectSearch(redirect)}
			className={buttonVariants({ variant: "link" })}
		>
			Already have an account? Sign in
		</Link>
	);

	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		validators: { onSubmit: signUpSchema },
		onSubmit: async ({ value }) => {
			await authClient.signUp.email(
				{ email: value.email, password: value.password, name: value.name },
				{
					onSuccess: () => {
						navigate({ href: safeRedirect(redirect) });
						toast.success("Account created.");
					},
					onError: ({ error }) => {
						if (error.code === SIGN_UP_CLOSED_CODE) {
							// Closed while the page was open: show the closed card.
							void status.refetch();
							toast.error("Sign-up is closed.");
							return;
						}
						toast.error("Account creation failed. Try another email address.");
					},
				},
			);
		},
	});

	if (isPending || status.isPending) {
		return <Loader />;
	}

	// An unreachable status reads as closed: the server decides either way.
	const state = status.data?.state ?? "closed";

	if (state === "closed") {
		return (
			<AuthCard kicker="Sign up" title="Sign-up is closed" footer={signInLink}>
				<p className="text-muted-foreground text-sm">
					This household already has its accounts. Ask a member to turn on
					“Allow sign-up” in Settings, then come back to this page.
				</p>
			</AuthCard>
		);
	}

	return (
		<AuthCard
			kicker="Sign up"
			title="Create account"
			description={OPEN_DESCRIPTIONS[state]}
			footer={signInLink}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					form.handleSubmit();
				}}
			>
				<form.Field name="name">
					{(field) => (
						<FormField
							label="Name"
							htmlFor={`${fieldId}-name`}
							errors={field.state.meta.errors}
						>
							<Input
								id={`${fieldId}-name`}
								name={field.name}
								autoComplete="name"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</FormField>
					)}
				</form.Field>

				<form.Field name="email">
					{(field) => (
						<FormField
							label="Email address"
							htmlFor={`${fieldId}-email`}
							errors={field.state.meta.errors}
						>
							<Input
								id={`${fieldId}-email`}
								name={field.name}
								type="email"
								autoComplete="email"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</FormField>
					)}
				</form.Field>

				<form.Field name="password">
					{(field) => (
						<FormField
							label="Password"
							htmlFor={`${fieldId}-password`}
							hint="At least 8 characters."
							errors={field.state.meta.errors}
						>
							<Input
								id={`${fieldId}-password`}
								name={field.name}
								type="password"
								autoComplete="new-password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</FormField>
					)}
				</form.Field>

				<form.Subscribe
					selector={(state) => ({
						canSubmit: state.canSubmit,
						isSubmitting: state.isSubmitting,
					})}
				>
					{({ canSubmit, isSubmitting }) => (
						<Button
							type="submit"
							className="mt-2 w-full"
							disabled={!canSubmit || isSubmitting}
						>
							{isSubmitting ? "Creating…" : "Create account"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</AuthCard>
	);
}
