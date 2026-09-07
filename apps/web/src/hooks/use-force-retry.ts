import { ORPCError } from "@orpc/client";
import { useCallback } from "react";

import { useConfirm } from "@/components/confirm-dialog";

/**
 * A disabled document type and a disabled automation are both out of the
 * automatic flow: `documentType.apply` and `rule.run` refuse them with
 * `BAD_REQUEST` unless the caller passes `force: true`
 * (`docs/document-types.md` §4). Applying one by hand stays possible — on
 * purpose, never by accident — which is exactly what this confirmation is.
 */

/** `true` when the refusal is "disabled, re-run with `force`". */
export function isDisabledTargetError(error: unknown): boolean {
	return (
		error instanceof ORPCError &&
		error.code === "BAD_REQUEST" &&
		error.message.includes("is disabled") &&
		error.message.includes("force")
	);
}

/** What was refused, which decides the wording of the confirmation. */
export type ForceTarget = "type" | "automation";

const PROMPTS: Record<
	ForceTarget,
	{ title: string; description: string; confirmLabel: string }
> = {
	type: {
		title: "This type is disabled. Apply anyway?",
		description:
			"A disabled type is ignored by the automatic detection; applying it by hand still works.",
		confirmLabel: "Apply anyway",
	},
	automation: {
		title: "This automation is disabled. Run anyway?",
		description:
			"A disabled automation never runs on its own; running it by hand still works.",
		confirmLabel: "Run anyway",
	},
};

export type ForceRetry = <T>(
	target: ForceTarget,
	attempt: (force: boolean) => Promise<T>,
) => Promise<T | null>;

/**
 * Runs `attempt(false)`, and on a "disabled" refusal asks whether to replay it
 * with `force: true`. Returns `null` when the user declined; every other error
 * is rethrown, so the caller keeps its own `toastApiError`.
 */
export function useForceRetry(): ForceRetry {
	const confirm = useConfirm();
	return useCallback(
		async (target, attempt) => {
			try {
				return await attempt(false);
			} catch (error) {
				if (!isDisabledTargetError(error)) {
					throw error;
				}
				const ok = await confirm(PROMPTS[target]);
				return ok ? await attempt(true) : null;
			}
		},
		[confirm],
	);
}
