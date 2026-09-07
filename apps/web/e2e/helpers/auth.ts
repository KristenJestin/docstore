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
 * Creates an account through the sign-up form and leaves the page on the
 * dashboard (`/`).
 */
/**
 * Opens `/login` and waits for the form.
 *
 * The development server compiles the route chunk on demand, and a request
 * that lands while it is busy sometimes never resolves: the router then keeps
 * showing its pending spinner. One reload always gets it back, which is
 * cheaper than a whole test retry.
 */
async function openLoginPage(page: Page): Promise<void> {
	const heading = page.getByRole("heading", { name: "Create account" });
	await page.goto("/login");
	try {
		await expect(heading).toBeVisible({ timeout: 15_000 });
	} catch {
		await page.reload();
		await expect(heading).toBeVisible({ timeout: 30_000 });
	}
}

export async function signUp(
	page: Page,
	name = "E2E Test User",
): Promise<E2eAccount> {
	const email = uniqueEmail();

	await openLoginPage(page);

	await page.getByLabel("Name").fill(name);
	await page.getByLabel("Email address").fill(email);
	await page.getByLabel("Password").fill(E2E_PASSWORD);
	await page.getByRole("button", { name: "Create account" }).click();

	await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
		timeout: 30_000,
	});

	return { email, password: E2E_PASSWORD, name };
}

/** Signs in with an existing account from the `/login` screen. */
export async function signIn(page: Page, account: E2eAccount): Promise<void> {
	await openLoginPage(page);
	await page
		.getByRole("button", { name: "Already have an account? Sign in" })
		.click();
	await expect(
		page.getByRole("heading", { name: "Welcome back" }),
	).toBeVisible();

	await page.getByLabel("Email address").fill(account.email);
	await page.getByLabel("Password").fill(account.password);
	await page.locator("form").getByRole("button", { name: "Sign in" }).click();

	await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
