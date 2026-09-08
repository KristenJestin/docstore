import { expect, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName } from "./helpers/cleanup";
import { ensureFreshFixtureDocument } from "./helpers/fixture-document";

/**
 * Document types (SPEC §9): creating one from a document, turning it into a
 * recurrence, giving it a layout, applying it to a selection, laying a
 * half-yearly timeline out and rewriting the titles from the template.
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

		// --- The Default moves onto the new layout -----------------------------
		// The type now has two, so the sortable list is shown: the fallback can be
		// handed over without deleting the layout that holds it.
		const makeDefault = page.getByRole("button", {
			name: `Make ${layoutName} the default layout`,
		});
		await expect(makeDefault).toBeVisible();
		await makeDefault.click();
		// Once it is the default, the row no longer offers the action.
		await expect(makeDefault).toBeHidden({ timeout: 15_000 });
		await expect(
			page.getByRole("button", { name: "Make Default the default layout" }),
		).toBeVisible();

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

	test("a semiannual type lays its timeline out in halves", async ({
		page,
	}) => {
		await signUp(page, "E2E Semiannual User");

		const typeName = runName("semiannual type");

		await page.getByRole("link", { name: "Document types" }).first().click();
		await page
			.getByRole("button", { name: "New document type" })
			.first()
			.click();
		const sheet = page.getByRole("dialog");
		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(typeName);
		await sheet.getByRole("switch", { name: "Recurring document" }).click();

		// --- Periodicity: semiannual -------------------------------------------
		await sheet.getByRole("combobox", { name: "Periodicity" }).click();
		await page.getByRole("option", { name: "Semiannual" }).click();

		// The quarter selector becomes a half-year one.
		const firstHalf = sheet
			.getByRole("button", { name: "Half-year 1" })
			.first();
		await expect(firstHalf).toBeVisible();
		const year = sheet.getByRole("textbox", { name: "First period year" });
		await year.fill("2024");
		await year.press("Enter");
		await firstHalf.click();
		await expect(sheet.getByText("H1 2024").first()).toBeVisible();

		await sheet.getByRole("button", { name: "Create document type" }).click();
		await expect(sheet).toBeHidden();

		// --- The timeline is keyed by half-year --------------------------------
		await page.getByRole("link", { name: typeName }).click();
		await expect(page.getByRole("heading", { name: typeName })).toBeVisible();
		await expect(page.getByText("Semiannual").first()).toBeVisible();

		const timeline = page.getByTestId("recurrence-timeline");
		await expect(timeline).toBeVisible({ timeout: 15_000 });
		await expect(timeline.getByText("2024-H1", { exact: true })).toBeVisible();
		await expect(timeline.getByText("2024-H2", { exact: true })).toBeVisible();
	});

	test("regenerate the titles of a type from its template", async ({
		page,
	}) => {
		await signUp(page, "E2E Title Rewrite User");

		const documentId = await ensureFreshFixtureDocument(page);
		await page.goto(`/documents/${documentId}`);

		// --- A date, so the document belongs to a period -----------------------
		const documentDate = page.getByRole("textbox", { name: "Document date" });
		await expect(documentDate).toBeVisible({ timeout: 20_000 });
		await documentDate.fill("2024-03-17");
		await documentDate.press("Enter");
		await expect(documentDate).toHaveValue("17 Mar 2024");

		// --- "Create type from this document" ----------------------------------
		const typePicker = page.getByRole("combobox", { name: "Document type" });
		await expect(typePicker).toBeVisible({ timeout: 20_000 });
		await typePicker.fill("Create");
		await page
			.getByRole("option", { name: "Create type from this document" })
			.click();
		await expect(page).toHaveURL(/\/types\/dty_/, { timeout: 30_000 });

		// The header only settles once `documentType.get` resolved: clicking
		// "Edit" before that lands on a button React is about to remount.
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		// --- Recurring: the default title template comes with the switch -------
		const typeName = runName("titled type");
		await page.getByRole("button", { name: "Edit" }).first().click();
		const sheet = page.getByRole("dialog");
		await expect(
			sheet.getByRole("heading", { name: "Edit document type" }),
		).toBeVisible();
		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(typeName);
		await sheet.getByRole("switch", { name: "Recurring document" }).click();

		const template = sheet.getByRole("textbox", { name: "Title template" });
		await expect(template).toHaveValue("{type} {period:MMMM yyyy}");
		await sheet.getByRole("button", { name: "Save" }).click();
		await expect(sheet).toBeHidden();

		// --- "Regenerate titles" shows a preview, then rewrites ----------------
		await page
			.getByRole("button", { name: "Regenerate titles", exact: true })
			.click();
		const confirm = page.getByRole("alertdialog");
		await expect(confirm.getByText(`${typeName} March 2024`)).toBeVisible({
			timeout: 15_000,
		});
		await confirm
			.getByRole("button", { name: "Regenerate titles", exact: true })
			.click();
		await expect(page.getByText(/1 title rewritten/)).toBeVisible({
			timeout: 20_000,
		});

		await page.goto(`/documents/${documentId}`);
		// The title of a document is an inline editor, not a heading.
		await expect(page.getByRole("button", { name: "Edit title" })).toHaveText(
			`${typeName} March 2024`,
			{ timeout: 20_000 },
		);
	});

	test("a category opens its extraction rules on a generic type", async ({
		page,
	}) => {
		await signUp(page, "E2E Generic Type User");

		// --- A category with no document type of its own ----------------------
		const categoryName = runName("extraction category");
		await page.goto("/settings/categories");
		await page.getByRole("button", { name: "New category" }).first().click();
		await page
			.getByRole("textbox", { name: "New category name" })
			.fill(categoryName);
		await page.getByRole("button", { name: "Create", exact: true }).click();
		await expect(
			page.getByRole("button", { name: `Rename ${categoryName}` }),
		).toHaveCount(1);

		// --- "Extraction rules" lands on the Layouts tab of `Any <Category>` ---
		await page
			.getByRole("button", { name: `Extraction rules of ${categoryName}` })
			.click();
		await expect(page).toHaveURL(/\/types\/dty_[^/]+\?tab=layouts/, {
			timeout: 30_000,
		});
		const typeUrl = page.url();
		await expect(
			page.getByRole("heading", { name: `Any ${categoryName}` }),
		).toBeVisible();
		await expect(page.getByRole("tab", { name: "Layouts" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		// The type owns the Default layout every type is created with: that is
		// where its extraction rules go.
		await expect(
			page.getByRole("button", { name: "Sample document" }),
		).toBeVisible();

		// --- Asking again reuses the same type, it never creates a second ------
		await page.goto("/settings/categories");
		await page
			.getByRole("button", { name: `Extraction rules of ${categoryName}` })
			.click();
		await expect(page).toHaveURL(typeUrl, { timeout: 30_000 });

		// The generic type is named after the category, so the run prefix only
		// reaches it once it is renamed: this is what hands it to the cleanup.
		const typeName = runName("any category");
		await page.getByRole("button", { name: "Edit" }).first().click();
		const sheet = page.getByRole("dialog");
		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(typeName);
		await sheet.getByRole("button", { name: "Save" }).click();
		await expect(sheet).toBeHidden();
		await expect(page.getByRole("heading", { name: typeName })).toBeVisible();
	});
});
