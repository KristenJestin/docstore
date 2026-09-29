/**
 * `?redirect=` of the sign-in and sign-up pages (issue #16, D16-03): where the
 * `_app` guard was going when it sent the visitor to `/login`.
 *
 * Only a path of this application is followed: anything else (another origin,
 * `//host`, `/\host`, a `javascript:` URL) falls back to the dashboard, so the
 * parameter cannot turn the sign-in page into an open redirect.
 */
export function safeRedirect(value: string | undefined): string {
	if (!value?.startsWith("/")) return "/";
	if (value.startsWith("//") || value.startsWith("/\\")) return "/";
	return value;
}
