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

const signUpSchema = z.object({
	name: z.string().trim().min(2, "Name must be at least 2 characters."),
	email: z.email("Enter a valid email address."),
	password: z.string().min(8, "Password must be at least 8 characters."),
});

export default function SignUpForm({
	onSwitchToSignIn,
}: {
	onSwitchToSignIn: () => void;
}) {
	const navigate = useNavigate();
	const { isPending } = authClient.useSession();
	const fieldId = useId();

	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		validators: { onSubmit: signUpSchema },
		onSubmit: async ({ value }) => {
			await authClient.signUp.email(
				{ email: value.email, password: value.password, name: value.name },
				{
					onSuccess: () => {
						navigate({ to: "/" });
						toast.success("Account created.");
					},
					onError: () => {
						toast.error("Account creation failed. Try another email address.");
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
			kicker="Sign up"
			title="Create account"
			description="One account per household member."
			footer={
				<Button variant="link" onClick={onSwitchToSignIn}>
					Already have an account? Sign in
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
