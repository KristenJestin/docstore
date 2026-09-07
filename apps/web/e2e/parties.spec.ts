import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName, runSlug } from "./helpers/cleanup";

test.describe("parties", () => {
	test("create a party, open it, add an alias then archive it", async ({
		page,
	}) => {
		await signUp(page, "E2E Parties User");

		// Unique name: the dev database is not reset between runs and the API
		// refuses duplicate names. The run prefix is also what the teardown
		// deletes afterwards.
		const partyName = runName("free");

		await page.getByRole("link", { name: "Parties" }).first().click();
		await expect(page).toHaveURL(/\/parties$/);
		await expect(page.getByRole("heading", { name: "Parties" })).toBeVisible();

		// --- Creation -------------------------------------------------------
		await page.getByRole("button", { name: "New party" }).first().click();

		const sheet = page.getByRole("dialog");
		await expect(
			sheet.getByRole("heading", { name: "New party" }),
		).toBeVisible();

		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(partyName);
		await sheet.getByLabel("Domains").fill("free.fr");
		await sheet.getByLabel("Domains").press("Enter");
		await expect(sheet.getByText("free.fr")).toBeVisible();

		await sheet.getByRole("button", { name: "Create party" }).click();

		// --- Detail page ----------------------------------------------------
		await expect(page).toHaveURL(/\/parties\/[^/]+$/);
		await expect(page.getByRole("heading", { name: partyName })).toBeVisible();
		await expect(page.getByText("free.fr")).toBeVisible();
		await expect(page.getByText("Company").first()).toBeVisible();

		// --- Presence in the list --------------------------------------------
		await page.getByRole("link", { name: "Parties" }).first().click();
		await expect(page).toHaveURL(/\/parties$/);
		await page.getByLabel("Search a party").fill(partyName);
		// Not `getByText`: the "Party … created." toast carries the name too.
		const row = page.getByRole("button", {
			name: `Open the ${partyName} page`,
		});
		await expect(row).toBeVisible({ timeout: 15_000 });
		await row.click();
		await expect(page).toHaveURL(/\/parties\/[^/]+$/);

		// --- Adding an alias --------------------------------------------------
		await page.getByRole("button", { name: "Edit" }).click();
		const editSheet = page.getByRole("dialog");
		await editSheet.getByLabel("Alias").fill("Iliad");
		await editSheet.getByLabel("Alias").press("Enter");
		await editSheet.getByRole("button", { name: "Save" }).click();

		await expect(page.getByText("Iliad")).toBeVisible();

		// --- Clearing an identifier -------------------------------------------
		// `party.update` merges `identifiers` key by key: without
		// `replaceIdentifiers`, emptying the field here would leave the stored
		// domain untouched. The sheet owns the whole block, so an emptied field
		// is a deletion — and it has to survive a reload.
		await page.getByRole("button", { name: "Edit" }).click();
		const domainSheet = page.getByRole("dialog");
		await domainSheet.getByRole("button", { name: "Remove free.fr" }).click();
		await expect(domainSheet.getByText("free.fr")).toHaveCount(0);
		await domainSheet.getByRole("button", { name: "Save" }).click();

		await page.reload();
		await expect(page.getByRole("heading", { name: partyName })).toBeVisible();
		await expect(page.getByText("free.fr")).toHaveCount(0);

		// --- Archiving --------------------------------------------------------
		await page.getByRole("button", { name: "Archive", exact: true }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Archive" })
			.click();

		await expect(page.getByText("Archived", { exact: true })).toBeVisible();
	});

	test("merge a party into another one", async ({ page }) => {
		await signUp(page, "E2E Merge User");

		// The API refuses a second live party sharing a name or a domain, so the
		// pair is built the only way it can be: the survivor carries the domain,
		// the absorbed one carries its own customer number. Merging is what
		// brings the two together.
		const targetName = runName("acme");
		const sourceName = runName("acme legacy");
		// Unique like the names: a domain already names a party, and a run whose
		// teardown could not sweep would block every later one.
		const domain = `${runSlug("acme")}.test`;
		const customerRef = `MERGE-${runSlug("ref")}`;

		const targetUrl = await createParty(page, targetName, { domain });
		const sourceUrl = await createParty(page, sourceName, { customerRef });

		// --- Merge ------------------------------------------------------------
		await page.getByRole("button", { name: "Merge into…" }).click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Merge this party" }),
		).toBeVisible();

		await dialog.getByRole("combobox", { name: "Merge into" }).fill(targetName);
		await page.getByRole("option", { name: targetName }).click();
		// The summary is the confirmation: nothing has moved yet.
		await expect(dialog.getByText("0 documents are relinked.")).toBeVisible();
		await dialog.getByRole("button", { name: "Merge", exact: true }).click();

		// --- The survivor keeps everything ------------------------------------
		await expect(page).toHaveURL(targetUrl);
		await expect(page.getByRole("heading", { name: targetName })).toBeVisible();
		// Its own documents and identifiers are untouched…
		await expect(page.getByText(/^0 documents · 0 relations/)).toBeVisible();
		await expect(page.getByText(domain)).toBeVisible();
		// …and what the absorbed party carried moved onto it.
		await expect(page.getByText(customerRef)).toBeVisible();
		await expect(page.getByText(sourceName).first()).toBeVisible();

		// --- The absorbed party is archived, never deleted --------------------
		await page.goto(sourceUrl);
		await expect(page.getByRole("heading", { name: sourceName })).toBeVisible();
		await expect(page.getByText("Archived", { exact: true })).toBeVisible();
	});

	test("a rejected identifier points at the party holding it", async ({
		page,
	}) => {
		await signUp(page, "E2E Conflict User");

		const holderName = runName("edf");
		const otherName = runName("edf gaz");
		const domain = `${runSlug("edf")}.test`;

		await createParty(page, holderName, { domain });
		await createParty(page, otherName);

		// The domain already names another party: the API answers `CONFLICT` and
		// the form says who holds it, right under the field.
		await page.getByRole("button", { name: "Edit" }).click();
		const sheet = page.getByRole("dialog");
		await sheet.getByLabel("Domains").fill(domain);
		await sheet.getByLabel("Domains").press("Enter");
		await sheet.getByRole("button", { name: "Save" }).click();

		await expect(sheet.getByText("Already used by")).toBeVisible();
		await expect(sheet.getByRole("link", { name: holderName })).toBeVisible();

		// "Merge instead" opens the merge with that party already picked.
		await sheet.getByRole("button", { name: "Merge instead" }).click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Merge this party" }),
		).toBeVisible();
		await expect(
			dialog.getByRole("combobox", { name: "Merge into" }),
		).toHaveValue(holderName);

		await dialog.getByRole("button", { name: "Merge", exact: true }).click();
		await expect(page.getByRole("heading", { name: holderName })).toBeVisible();
		await expect(page.getByText(otherName).first()).toBeVisible();
	});

	test("find duplicate parties, ignore then merge from the panel", async ({
		page,
	}) => {
		await signUp(page, "E2E Duplicates User");

		// `assertNoDuplicate` only refuses a same-named party of the same type:
		// one company and one person sharing a name is exactly the pair
		// `party.duplicates` is there to report.
		const name = runName("orange");
		await createParty(page, name);
		const secondUrl = await createParty(page, name, { type: "Person" });

		await page.getByRole("link", { name: "Parties" }).first().click();
		await page.getByRole("button", { name: "Find duplicates" }).click();

		const pair = page.getByRole("listitem").filter({ hasText: name }).first();
		await expect(pair).toBeVisible({ timeout: 15_000 });
		await expect(pair.getByText("Same name")).toBeVisible();

		// Ignoring is local to the panel: the pair only hides.
		await pair.getByRole("button", { name: "Ignore" }).click();
		await expect(
			page.getByRole("listitem").filter({ hasText: name }),
		).toHaveCount(0);
		await page.getByRole("switch", { name: "Show ignored" }).click();
		await expect(pair.getByText("Ignored")).toBeVisible();

		// The newer party is absorbed by the older one, which the pair puts first.
		await pair.getByRole("button", { name: /^Merge B into A/ }).click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", { name: "Merge this party" }),
		).toBeVisible();
		await dialog.getByRole("button", { name: "Merge", exact: true }).click();

		// The panel refreshes on its own: an archived party is no duplicate.
		await expect(
			page.getByRole("listitem").filter({ hasText: name }),
		).toHaveCount(0, { timeout: 15_000 });

		await page.goto(secondUrl);
		await expect(page.getByText("Archived", { exact: true })).toBeVisible();
	});
});

/**
 * Creates a party through the sheet of `/parties` and returns the URL of its
 * page, where the creation leaves the browser.
 */
async function createParty(
	page: Page,
	name: string,
	options: { domain?: string; customerRef?: string; type?: string } = {},
): Promise<string> {
	await page.getByRole("link", { name: "Parties" }).first().click();
	await expect(page).toHaveURL(/\/parties$/);
	await page.getByRole("button", { name: "New party" }).first().click();

	const sheet = page.getByRole("dialog");
	await expect(sheet.getByRole("heading", { name: "New party" })).toBeVisible();
	await sheet.getByRole("textbox", { name: "Name", exact: true }).fill(name);
	if (options.type) {
		await sheet.getByRole("combobox", { name: "Type" }).click();
		await page.getByRole("option", { name: options.type }).click();
	}
	if (options.domain) {
		await sheet.getByLabel("Domains").fill(options.domain);
		await sheet.getByLabel("Domains").press("Enter");
	}
	if (options.customerRef) {
		await sheet.getByLabel("Customer number").fill(options.customerRef);
	}
	await sheet.getByRole("button", { name: "Create party" }).click();

	await expect(page).toHaveURL(/\/parties\/[^/]+$/);
	await expect(page.getByRole("heading", { name })).toBeVisible();
	return page.url();
}
