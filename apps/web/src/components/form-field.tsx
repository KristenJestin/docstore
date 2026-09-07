import { Label } from "@docstore/ui/components/label";
import { cn } from "@docstore/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * Normalises `@tanstack/react-form` errors: depending on the validator they
 * arrive as a `string`, a `ZodIssue` or `undefined`.
 */
export function fieldErrorMessages(errors: unknown[] | undefined): string[] {
	if (!errors) {
		return [];
	}
	const messages: string[] = [];
	for (const error of errors) {
		if (!error) {
			continue;
		}
		if (typeof error === "string") {
			messages.push(error);
			continue;
		}
		if (
			typeof error === "object" &&
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
		) {
			messages.push((error as { message: string }).message);
		}
	}
	return messages;
}

export interface FormFieldProps {
	label: ReactNode;
	/** `id` of the described control — pass the same one to the `Input`. */
	htmlFor?: string;
	/** Help text below the control. */
	hint?: ReactNode;
	/** Raw errors from `field.state.meta.errors`. */
	errors?: unknown[];
	required?: boolean;
	children: ReactNode;
	className?: string;
}

/** Form row: label, control, hint and error messages. */
export function FormField({
	label,
	htmlFor,
	hint,
	errors,
	required,
	children,
	className,
}: FormFieldProps) {
	const messages = fieldErrorMessages(errors);

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<Label htmlFor={htmlFor}>
				{label}
				{required ? (
					<span aria-hidden className="text-muted-foreground">
						*
					</span>
				) : null}
			</Label>
			{children}
			{messages.length > 0 ? (
				<p className="text-destructive text-xs">{messages.join(" · ")}</p>
			) : hint ? (
				<p className="text-muted-foreground text-xs">{hint}</p>
			) : null}
		</div>
	);
}

/** Group of fields preceded by a section label. */
export function FormSection({
	title,
	description,
	children,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={cn("flex flex-col gap-3", className)}>
			<div>
				<p className="mono-label">{title}</p>
				{description ? (
					<p className="mt-1 text-muted-foreground text-xs">{description}</p>
				) : null}
			</div>
			{children}
		</section>
	);
}
