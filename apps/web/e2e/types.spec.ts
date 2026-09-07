import { expect, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName } from "./helpers/cleanup";
import { ensureFreshFixtureDocument } from "./helpers/fixture-document";

/**
 * Document types (SPEC §9): creating one from a document, turning it into a
 * recurrence, giving it a layout and applying it to a selection.
 */
test.describe("document types", () => {
	test.slow();

	test("create a type from a document, make it recurring and test a layout", async ({
		page,
	}) => {
		await signUp(page, "E2E Type From Document User");

		const documentId = await ensureFreshFixtureDocument(page);
		await page.goto(`/documents/${documentId}`);

		// --- "Create type from this document" ---------------------------------
		const typePicker = page.getByRole("combobox", { name: "Document type" });
		await expect(typePicker).toBeVisible({ timeout: 20_000 });
		await typePicker.fill("Create");
		await page
			.getByRole("option", { name: "Create type from this document" })
			.click();

		await expect(page).toHaveURL(/\/types\/dty_/, { timeout: 30_000 });
		const typeUrl = page.url();
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		// --- Renaming it, and turning it into a monthly recurrence -------------
		// The type takes the title of the document it was created from: renaming
		// it is what hands it to the cleanup of the run.
		const typeName = runName("type from document");
		await page.getByRole("button", { name: "Edit" }).first().click();
		const sheet = page.getByRole("dialog");
		await expect(
			sheet.getByRole("heading", { name: "Edit document type" }),
		).toBeVisible();
		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(typeName);
		await sheet.getByRole("switch", { name: "Recurring document" }).click();
		await expect(
			sheet.getByRole("combobox", { name: "Periodicity" }),
		).toBeVisible();
		await sheet.getByRole("button", { name: "Save" }).click();
		await expect(sheet).toBeHidden();

		// --- The timeline appears on the Overview tab --------------------------
		await expect(page.getByTestId("recurrence-timeline")).toBeVisible({
			timeout: 15_000,
		});

		// --- Layouts tab: create one from the document, then test it -----------
		await page.getByRole("tab", { name: "Layouts" }).click();
		await expect(
			page.getByRole("button", { name: "Sample document" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Sample document" }).click();
		await page.getByPlaceholder("Search a document…").fill("text-layer");
		await page
			.getByRole("option", { name: /text-layer/ })
			.first()
			.click();

		const layoutName = runName("layout");
		await page.getByRole("textbox", { name: "Layout name" }).fill(layoutName);
		await page.getByRole("button", { name: "Create layout" }).click();
		// Not a loose match: the "Layout … created" toast carries the name too.
		await expect(page.getByText(layoutName, { exact: true })).toBeVisible({
			timeout: 15_000,
		});

		// "Test layout": pick the document, then run the layout on it.
		await page.getByRole("button", { name: "Document to test" }).click();
		await page.getByPlaceholder("Search a document…").fill("text-layer");
		await page
			.getByRole("option", { name: /text-layer/ })
			.first()
			.click();

		await page.getByRole("button", { name: `Test ${layoutName}` }).click();
		// The layout has no extraction rule yet: the result panel says so, and the
		// signature seeded from the document matches it.
		await expect(
			page.getByText("No extraction rule is attached to this layout."),
		).toBeVisible({ timeout: 20_000 });

		await page.goto(typeUrl);
		await expect(page.getByRole("heading", { name: typeName })).toBeVisible();
	});

	test("apply a document type to a selection from the bulk bar", async ({
		page,
	}) => {
		await signUp(page, "E2E Bulk Type User");

		const typeName = runName("bulk type");

		// --- A minimal type ----------------------------------------------------
		await page.getByRole("link", { name: "Document types" }).first().click();
		await page
			.getByRole("button", { name: "New document type" })
			.first()
			.click();
		const sheet = page.getByRole("dialog");
		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(typeName);
		await sheet.getByRole("button", { name: "Create document type" }).click();
		await expect(sheet).toBeHidden();
		await expect(page.getByRole("link", { name: typeName })).toBeVisible();

		// --- Selecting a document and applying the type ------------------------
		await page.getByRole("link", { name: "Documents" }).first().click();
		await expect(
			page.getByRole("heading", { name: "Documents" }),
		).toBeVisible();

		// `(?!all$)` keeps the header "Select all" out of the way.
		const firstCheckbox = page
			.getByRole("checkbox", { name: /^Select (?!all$)/ })
			.first();
		await expect(firstCheckbox).toBeVisible({ timeout: 20_000 });
		const title = (
			(await firstCheckbox.getAttribute("aria-label")) ?? ""
		).replace(/^Select /, "");
		await firstCheckbox.click();
		await expect(page.getByText(/1 selected/)).toBeVisible();

		await page.getByRole("button", { name: "Type", exact: true }).click();
		await page
			.getByRole("combobox", { name: "Document type to apply" })
			.fill(typeName);
		await page.getByRole("option", { name: typeName }).first().click();

		// --- The type is now carried by the document ---------------------------
		await expect(page.getByText(/Document type applied/)).toBeVisible({
			timeout: 30_000,
		});

		await page
			.getByRole("button", { name: `Open ${title}` })
			.first()
			.click();
		await expect(page).toHaveURL(/\/documents\/doc_/);
		await expect(page.getByRole("link", { name: typeName })).toBeVisible({
			timeout: 20_000,
		});
	});
});
