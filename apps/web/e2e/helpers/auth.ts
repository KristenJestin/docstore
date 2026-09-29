import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = "Password123!";

/** Unique address per test: the dev database is never reset. */
export function uniqueEmail(): string {
	const random = Math.random().toString(36).slice(2);
	return `e2e+${Date.now()}-${random}@test.local`;
}

export interface E2eAccount {
	email: string;
	password: string;
	name: string;
}

/**
 * Opens `path` and waits for `heading`.
 *
 * The development server compiles the route chunk on demand, and a request
 * that lands while it is busy sometimes never resolves: the router then keeps
 * showing its pending spinner. One reload always gets it back, which is
 * cheaper than a whole test retry.
 */
export async function openAuthPage(
	page: Page,
	path: string,
	heading: string,
): Promise<void> {
	const title = page.getByRole("heading", { name: heading });
	await page.goto(path);
	try {
		await expect(title).toBeVisible({ timeout: 15_000 });
	} catch {
		await page.reload();
		await expect(title).toBeVisible({ timeout: 30_000 });
	}
}

/**
 * Creates an account through the `/signup` form and leaves the page on the
 * dashboard (`/`). Sign-up is open for the whole run: the global setup turns
 * "Allow sign-up" on and the teardown restores it.
 */
export async function signUp(
	page: Page,
	name = "E2E Test User",
): Promise<E2eAccount> {
	const email = uniqueEmail();

	await openAuthPage(page, "/signup", "Create account");

	await page.getByLabel("Name").fill(name);
	await page.getByLabel("Email address").fill(email);
	await page.getByLabel("Password").fill(E2E_PASSWORD);
	await page.getByRole("button", { name: "Create account" }).click();

	await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
		timeout: 30_000,
	});

	return { email, password: E2E_PASSWORD, name };
}

/** Fills and sends the `/login` form, wherever it leads next. */
export async function submitSignIn(
	page: Page,
	account: E2eAccount,
): Promise<void> {
	await page.getByLabel("Email address").fill(account.email);
	await page.getByLabel("Password").fill(account.password);
	await page.locator("form").getByRole("button", { name: "Sign in" }).click();
}

/** Signs in with an existing account from the `/login` screen. */
export async function signIn(page: Page, account: E2eAccount): Promise<void> {
	await openAuthPage(page, "/login", "Welcome back");
	await submitSignIn(page, account);
	await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
