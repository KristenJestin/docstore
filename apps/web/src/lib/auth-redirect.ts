import { z } from "zod";

export { safeRedirect } from "@docstore/shared/auth-redirect";

/** `validateSearch` of `/login` and `/signup`: keeps a string, drops the rest. */
export const authSearchSchema = z.object({
	redirect: z.string().optional().catch(undefined),
});
export type AuthSearch = z.infer<typeof authSearchSchema>;

/** Search handed over to the other page, without an empty `?redirect=`. */
export function redirectSearch(redirect: string | undefined): AuthSearch {
	return redirect ? { redirect } : {};
}
