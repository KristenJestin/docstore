import { FUTURE_EXPIRY_MESSAGE } from "@docstore/shared/common";
import { ORPCError } from "@orpc/server";

/**
 * Refuses an expiry that has already passed.
 *
 * The shared inputs (`createShareLinkInput`, `createUploadLinkInput`,
 * `createApiKeyInput`) all build on `futureDatetimeSchema`, but a Zod schema
 * only protects the callers that go through it: the MCP tools declare their own
 * input shapes and hand the value straight to the service. Enforcing the rule
 * here is what makes "an expiry is in the future" true for every caller instead
 * of just the oRPC ones — a link born expired is dead on arrival, and a key born
 * expired silently never authenticates.
 */
export function assertFutureExpiry(
	value: string | Date | null | undefined,
	now: Date = new Date(),
): void {
	if (value === null || value === undefined) return;
	const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
	if (Number.isNaN(timestamp)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The expiry date is not a valid ISO 8601 instant.",
		});
	}
	if (timestamp <= now.getTime()) {
		throw new ORPCError("BAD_REQUEST", { message: FUTURE_EXPIRY_MESSAGE });
	}
}
