import { expect, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName, runSlug } from "./helpers/cleanup";

/**
 * Issue #15: a change made with an API key is listed on the Activity page
 * under the key's name, and the key list says it was used a moment ago.
 */
test("a tag created with an API key is listed under that key, which reads as used just now", async ({
	page,
}) => {
	await signUp(page);
	const keyName = runName("agent");
	const tagName = runSlug("traced");

	// The session creates the key, the key creates the tag.
	const created = await page.request.post("/api-reference/api-keys", {
		data: { name: keyName, scopes: ["read", "write"] },
	});
	expect(created.ok()).toBe(true);
	const { secret } = (await created.json()) as { secret: string };

	const tagged = await page.request.post("/api-reference/tags", {
		headers: { Authorization: `Bearer ${secret}` },
		data: { name: tagName },
	});
	expect(tagged.ok()).toBe(true);

	await page.goto("/activity");
	await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
	const row = page.getByRole("listitem").filter({ hasText: tagName });
	await expect(row).toContainText(keyName);
	await expect(row).toContainText("created");

	// Filtering on the key keeps the entry.
	await row.getByRole("button", { name: keyName }).click();
	await expect(page).toHaveURL(/actorKeyId=key_/);
	await expect(
		page.getByRole("listitem").filter({ hasText: tagName }),
	).toBeVisible();

	await page.goto("/settings/api-keys");
	await expect(
		page.getByRole("listitem").filter({ hasText: keyName }),
	).toContainText("used just now");
});
