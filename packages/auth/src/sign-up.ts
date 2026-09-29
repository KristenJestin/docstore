import type { Db } from "@docstore/db";
import {
	SETTING_DEFINITIONS,
	SIGN_UP_CLOSED_CODE,
	type SignUpStatus,
} from "@docstore/shared/settings";
import { APIError } from "better-auth/api";

/**
 * Who may create an account (issue #16).
 *
 * D16-01: sign-up is always open while the installation has no account (first
 * run); once one exists it follows the "Allow sign-up" setting, off by
 * default. D16-02: the check runs on the server, in the Better Auth sign-up
 * path, not only in the interface.
 */

const ALLOW_SIGN_UP_KEY = "auth.allowSignUp";

export async function getSignUpStatus(db: Db): Promise<SignUpStatus> {
	const existing = await db.query.user.findFirst({ columns: { id: true } });
	if (!existing) {
		return { open: true, state: "first-user" };
	}

	const row = await db.query.setting.findFirst({
		columns: { value: true },
		where: (setting, { eq }) => eq(setting.key, ALLOW_SIGN_UP_KEY),
	});
	const definition = SETTING_DEFINITIONS[ALLOW_SIGN_UP_KEY];
	const parsed = definition.schema.safeParse(row?.value);
	const allowed = parsed.success
		? parsed.data === true
		: definition.defaultValue === true;

	return allowed
		? { open: true, state: "allowed" }
		: { open: false, state: "closed" };
}

/** The error the sign-up endpoint answers with when sign-up is closed. */
export function signUpClosedError(): APIError {
	return new APIError("FORBIDDEN", {
		code: SIGN_UP_CLOSED_CODE,
		message:
			"Sign-up is closed. Ask a member of the household to turn on “Allow sign-up” in Settings.",
	});
}

/** Throws `SIGN_UP_CLOSED` (403) unless an account may be created now. */
export async function assertSignUpOpen(db: Db): Promise<void> {
	const status = await getSignUpStatus(db);
	if (!status.open) {
		throw signUpClosedError();
	}
}
