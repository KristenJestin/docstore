import { expect, test } from "@playwright/test";

import { signIn, signUp } from "./helpers/auth";

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
