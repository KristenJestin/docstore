import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName, runSlug } from "./helpers/cleanup";

/** Playwright runs from `apps/web` (`bun run test:e2e`). */
const FIXTURE = path.resolve(
	process.cwd(),
	"../../packages/ocr/test/fixtures/text-layer.pdf",
);

/**
 * The sha256 of an original is unique across the whole database: the fixture
 * is uploaded then permanently deleted so the public drop that follows really
 * creates a document instead of reporting a duplicate.
 */
async function purgeFixtureDocument(page: Page): Promise<void> {
	await page.goto("/documents");
	await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

	await page.getByRole("button", { name: "Add", exact: true }).first().click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("heading", { name: "Add documents" }),
	).toBeVisible();
	// Picking the file is the whole gesture: the upload starts on its own.
	await dialog.locator('input[type="file"]').setInputFiles(FIXTURE);
	await expect(dialog.getByText("text-layer.pdf")).toBeVisible();

	const created = dialog.getByRole("button", { name: "Open", exact: true });
	const duplicate = dialog.getByRole("button", { name: "Open the original" });
	const trashed = dialog.getByRole("button", { name: "Restore" });
	await expect(created.or(duplicate).or(trashed)).toBeVisible({
		timeout: 30_000,
	});

	if ((await trashed.count()) > 0) {
		await trashed.click();
		await expect(duplicate).toBeVisible();
	}

	await created.or(duplicate).first().click();
	await expect(page).toHaveURL(/\/documents\/doc_/);

	// The URL changes before `document.get` resolves: without this the header
	// actions are still a skeleton and the "Trash" probe below reads zero.
	await expect(
		page.getByRole("button", { name: "Reprocess" }).first(),
	).toBeVisible({ timeout: 30_000 });

	if ((await page.getByRole("button", { name: "Trash" }).count()) > 0) {
		await page.getByRole("button", { name: "Trash" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Move to trash" })
			.click();
	}
	await page.getByRole("button", { name: "Delete permanently" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete permanently" })
		.click();
	await expect(page).toHaveURL(/\/documents$/);
}

test.describe("settings", () => {
	test.slow();

	test("taxonomy, custom fields, API keys and a public upload link", async ({
		page,
	}) => {
		await signUp(page, "E2E Settings User");

		// --- The sidebar entry opens the first tab ----------------------------
		await page.getByRole("link", { name: "Settings" }).first().click();
		await expect(page).toHaveURL(/\/settings\/general$/);
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

		// --- General: the content language is a saved-on-change select --------
		const contentLanguage = page.getByRole("combobox", {
			name: "Content language",
		});
		await expect(contentLanguage).toBeVisible();

		await contentLanguage.click();
		await page.getByRole("option", { name: "French (France)" }).click();
		// Saved on its own, like every other control of this screen.
		await expect(page.getByText("Content language saved.")).toBeVisible();

		await page.reload();
		await expect(contentLanguage).toContainText("French (France)");

		// Back to the shipped default, so the run leaves the household as it
		// found it.
		await contentLanguage.click();
		await page
			.getByRole("option", { name: "English (United Kingdom)" })
			.click();
		await expect(contentLanguage).toContainText("English (United Kingdom)");

		// --- General: what a ZIP becomes at every intake door ------------------
		const archives = page.getByRole("combobox", { name: "Archives" });
		await expect(archives).toContainText("Extract");

		await archives.click();
		await page.getByRole("option", { name: "Both" }).click();
		await expect(page.getByText("Archives saved.")).toBeVisible();

		await page.reload();
		await expect(archives).toContainText("Both");

		// Back to the shipped default: the upload tracker prefills its three
		// buttons from this setting, and the documents spec expects "Extract".
		await archives.click();
		await page.getByRole("option", { name: "Extract" }).click();
		await expect(archives).toContainText("Extract");

		// --- Categories: a root, a child, then a rename -----------------------
		const rootName = runName("root");
		const childName = runName("child");
		const renamedChild = runName("renamed");

		await page.getByRole("link", { name: "Categories" }).click();
		await expect(page).toHaveURL(/\/settings\/categories$/);

		// The dialogs and popovers are portalled outside `main`: scoping the
		// assertions to the list keeps them free of leftover popup content.
		const rows = page.locator("main li");

		/**
		 * The tree nests a `ul` inside the `li` of a parent (one sortable group
		 * per level), so counting `li` by text would also match the ancestors:
		 * a category is identified by its own "Rename …" action instead.
		 */
		const categoryRow = (name: string) =>
			page.getByRole("button", { name: `Rename ${name}` });

		await page.getByRole("button", { name: "New category" }).first().click();
		await page
			.getByRole("textbox", { name: "New category name" })
			.fill(rootName);
		await page.getByRole("button", { name: "Create", exact: true }).click();
		await expect(categoryRow(rootName)).toHaveCount(1);

		await page
			.getByRole("button", { name: `Add a subcategory to ${rootName}` })
			.click();
		await page
			.getByRole("textbox", { name: "New category name" })
			.fill(childName);
		await page.getByRole("button", { name: "Create", exact: true }).click();
		await expect(categoryRow(childName)).toHaveCount(1);

		await categoryRow(childName).click();
		await page
			.getByRole("textbox", { name: "Category name", exact: true })
			.fill(renamedChild);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(categoryRow(renamedChild)).toHaveCount(1);
		await expect(categoryRow(childName)).toHaveCount(0);

		// --- Tags: two tags, then a merge -------------------------------------
		const sourceTag = runSlug("source");
		const targetTag = runSlug("target");

		await page.getByRole("link", { name: "Tags" }).click();
		await expect(page).toHaveURL(/\/settings\/tags$/);

		for (const name of [sourceTag, targetTag]) {
			await page.getByRole("button", { name: "New tag" }).first().click();
			await page.getByRole("textbox", { name: "New tag name" }).fill(name);
			await page.getByRole("button", { name: "Create", exact: true }).click();
			await expect(rows.filter({ hasText: name })).toHaveCount(1);
		}

		await page.getByRole("button", { name: `Merge ${sourceTag}` }).click();
		await page.getByRole("combobox", { name: "Target tag" }).click();
		await page.getByRole("option", { name: targetTag }).click();
		await page.getByRole("button", { name: "Merge", exact: true }).click();
		await expect(rows.filter({ hasText: sourceTag })).toHaveCount(0);
		await expect(rows.filter({ hasText: targetTag })).toHaveCount(1);

		// --- Custom fields: a "money" field -----------------------------------
		const fieldName = runName("amount");

		await page.getByRole("link", { name: "Custom fields" }).click();
		await expect(page).toHaveURL(/\/settings\/custom-fields$/);

		await page.getByRole("button", { name: "New field" }).first().click();
		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(fieldName);
		await page.getByRole("combobox", { name: "Type" }).click();
		await page.getByRole("option", { name: "Amount" }).click();
		await expect(page.getByRole("textbox", { name: "Currency" })).toHaveValue(
			"EUR",
		);
		await page.getByRole("button", { name: "Create field" }).click();

		const fieldRow = rows.filter({ hasText: fieldName });
		await expect(fieldRow).toBeVisible();
		await expect(fieldRow.getByText("Amount", { exact: true })).toBeVisible();

		// --- API key: the secret is shown once, the prefix stays in the list ---
		const keyName = runName("key");

		await page.getByRole("link", { name: "API keys" }).click();
		await expect(page).toHaveURL(/\/settings\/api-keys$/);

		await page.getByRole("button", { name: "New key" }).first().click();
		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(keyName);
		await page.getByRole("button", { name: "Create key" }).click();

		const secret = await page.getByTestId("api-key-secret").innerText();
		expect(secret).toMatch(/^dsk_/);
		await page.getByRole("button", { name: "I have copied it" }).click();

		const keyRow = rows.filter({ hasText: keyName });
		await expect(keyRow).toBeVisible();
		await expect(keyRow.getByText(`${secret.slice(0, 8)}…`)).toBeVisible();

		// --- Upload link: create it, then drop a file on the public page -------
		const linkName = runName("link");

		await page.getByRole("link", { name: "Upload links" }).click();
		await expect(page).toHaveURL(/\/settings\/upload-links$/);

		await page.getByRole("button", { name: "New link" }).first().click();
		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(linkName);
		await page.getByRole("button", { name: "Create link" }).click();

		const linkRow = rows.filter({ hasText: linkName });
		await expect(linkRow).toBeVisible();
		const publicUrl = await linkRow.getByTestId("upload-link-url").innerText();
		const token = publicUrl.split("/u/").at(-1) ?? "";
		expect(token.length).toBeGreaterThan(0);

		await purgeFixtureDocument(page);

		await page.goto(`/u/${token}`);
		await expect(page.getByRole("heading", { name: linkName })).toBeVisible();

		// The public page sends on pick too: no button to press.
		await page.locator('input[type="file"]').setInputFiles(FIXTURE);
		await expect(page.getByTestId("upload-result")).toContainText(
			"text-layer.pdf",
			{ timeout: 30_000 },
		);
		await expect(page.getByText("1 file received")).toBeVisible({
			timeout: 30_000,
		});
	});
});
