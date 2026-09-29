import { expect, test } from "@playwright/test";

import {
	E2E_PASSWORD,
	openAuthPage,
	signIn,
	signUp,
	submitSignIn,
	uniqueEmail,
} from "./helpers/auth";
import { API_KEY_ENV, apiClient, e2eBaseUrl } from "./helpers/cleanup";

/**
 * "Allow sign-up" through the admin key of the run (issue #16). The global
 * setup leaves it on for the specs; a test that closes it opens it again.
 */
async function setAllowSignUp(value: boolean): Promise<void> {
	const secret = process.env[API_KEY_ENV];
	if (!secret) {
		throw new Error("No admin key for this run: the global setup failed.");
	}
	await apiClient(e2eBaseUrl(), secret).settings.set({
		key: "auth.allowSignUp",
		value,
	});
}

test.describe("authentication", () => {
	test("a visitor can create an account and lands in the application", async ({
		page,
	}) => {
		const account = await signUp(page, "E2E Test User");

		await expect(
			page.getByRole("heading", { name: "Dashboard" }),
		).toBeVisible();
		await expect(page.getByText(account.name)).toBeVisible();
	});

	test("an existing user can sign in", async ({ page }) => {
		const account = await signUp(page, "E2E Login User");

		// New anonymous session: start again from a cookie-less context.
		await page.context().clearCookies();
		await signIn(page, account);

		await expect(page.getByText(account.name)).toBeVisible();
	});
});

/** Issue #16: sign-in and sign-up have their own URL, sign-up can be closed. */
test.describe("sign-in and sign-up pages", () => {
	test("/login shows sign-in, /signup shows sign-up, the links change the URL and reload keeps the page", async ({
		page,
	}) => {
		await openAuthPage(page, "/login", "Welcome back");
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Welcome back" }),
		).toBeVisible();

		await page
			.getByRole("link", { name: "No account yet? Create account" })
			.click();
		await expect(page).toHaveURL(/\/signup$/);
		await expect(
			page.getByRole("heading", { name: "Create account" }),
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Create account" }),
		).toBeVisible();

		await page
			.getByRole("link", { name: "Already have an account? Sign in" })
			.click();
		await expect(page).toHaveURL(/\/login$/);
		await expect(
			page.getByRole("heading", { name: "Welcome back" }),
		).toBeVisible();

		await page.goBack();
		await expect(page).toHaveURL(/\/signup$/);
	});

	test("after sign-in the user returns to the page they asked for", async ({
		page,
	}) => {
		const account = await signUp(page, "E2E Redirect User");
		await page.context().clearCookies();

		await page.goto("/documents?q=invoice");
		await expect(page).toHaveURL(/\/login\?redirect=/);
		await expect(
			page.getByRole("heading", { name: "Welcome back" }),
		).toBeVisible();

		// The redirect follows the visitor to /signup and back.
		await page
			.getByRole("link", { name: "No account yet? Create account" })
			.click();
		await expect(page).toHaveURL(/\/signup\?redirect=/);
		await page
			.getByRole("link", { name: "Already have an account? Sign in" })
			.click();
		await expect(page).toHaveURL(/\/login\?redirect=/);

		await submitSignIn(page, account);
		await expect(page).toHaveURL(/\/documents\?q=invoice$/);
	});

	test("with at least one user and sign-up closed, /signup explains why and the sign-up endpoint refuses", async ({
		page,
	}) => {
		await setAllowSignUp(false);
		try {
			await openAuthPage(page, "/signup", "Sign-up is closed");
			await expect(page.getByText("“Allow sign-up” in Settings")).toBeVisible();
			await expect(page.getByLabel("Email address")).toHaveCount(0);

			// Hiding the form is not the lock: the endpoint refuses on its own.
			const origin = new URL(page.url()).origin;
			const response = await page.request.post("/api/auth/sign-up/email", {
				headers: { origin },
				data: {
					name: "Stranger",
					email: uniqueEmail(),
					password: E2E_PASSWORD,
				},
			});
			expect(response.status()).toBe(403);
			expect((await response.json()).code).toBe("SIGN_UP_CLOSED");
		} finally {
			await setAllowSignUp(true);
		}
	});

	test("a signed-in member turns Allow sign-up on in Settings, then a new person can sign up", async ({
		page,
	}) => {
		const member = await signUp(page, "E2E Member");
		await setAllowSignUp(false);
		try {
			await page.goto("/settings/general");
			const toggle = page.getByRole("switch", { name: "Allow sign-up" });
			await expect(toggle).not.toBeChecked();

			await toggle.click();
			await expect(page.getByText("Allow sign-up saved.")).toBeVisible();
			await expect(toggle).toBeChecked();

			// The new person, on a device without a session.
			await page.context().clearCookies();
			const newcomer = await signUp(page, "E2E Newcomer");
			await expect(page.getByText(newcomer.name)).toBeVisible();

			// Back as the member, sign-up is closed again from Settings.
			await page.context().clearCookies();
			await signIn(page, member);
			await page.goto("/settings/general");
			await page.getByRole("switch", { name: "Allow sign-up" }).click();
			await expect(page.getByText("Allow sign-up saved.")).toBeVisible();

			await page.context().clearCookies();
			await openAuthPage(page, "/signup", "Sign-up is closed");
		} finally {
			await setAllowSignUp(true);
		}
	});
});
