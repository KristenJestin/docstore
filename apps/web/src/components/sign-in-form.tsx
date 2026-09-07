import { Button } from "@docstore/ui/components/button";
import { Input } from "@docstore/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";

import { AuthCard } from "./auth-card";
import { FormField } from "./form-field";
import Loader from "./loader";

const signInSchema = z.object({
	email: z.email("Enter a valid email address."),
	password: z.string().min(8, "Password must be at least 8 characters."),
});

export default function SignInForm({
	onSwitchToSignUp,
}: {
	onSwitchToSignUp: () => void;
}) {
	const navigate = useNavigate();
	const { isPending } = authClient.useSession();
	const fieldId = useId();

	const form = useForm({
		defaultValues: { email: "", password: "" },
		validators: { onSubmit: signInSchema },
		onSubmit: async ({ value }) => {
			await authClient.signIn.email(
				{ email: value.email, password: value.password },
				{
					onSuccess: () => {
						navigate({ to: "/" });
						toast.success("Signed in.");
					},
					onError: () => {
						toast.error("Sign-in failed. Check your email and password.");
					},
				},
			);
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<AuthCard
			kicker="Sign in"
			title="Welcome back"
			description="Open your household document library."
			footer={
				<Button variant="link" onClick={onSwitchToSignUp}>
					No account yet? Create account
				</Button>
			}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					form.handleSubmit();
				}}
			>
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
							errors={field.state.meta.errors}
						>
							<Input
								id={`${fieldId}-password`}
								name={field.name}
								type="password"
								autoComplete="current-password"
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
							{isSubmitting ? "Signing in…" : "Sign in"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</AuthCard>
	);
}
