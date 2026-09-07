import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName, runSlug } from "./helpers/cleanup";
import { ensureFreshFixtureDocument } from "./helpers/fixture-document";

/**
 * The two halves of the rule engine, now in two different places (SPEC §3 and
 * §9): the cross-cutting automations under Settings, and the extraction rules
 * inside the layout of a document type.
 */

const TOTAL_AMOUNT_FIELD = /^(Total amount|Montant TTC)$/;

/** Picks an option of a `Select` / `Combobox` that is already open. */
async function chooseOption(page: Page, name: string | RegExp): Promise<void> {
	await page.getByRole("option", { name }).first().click();
}

test.describe("automations", () => {
	test.slow();

	test("create an automation under Settings, test it and run it", async ({
		page,
	}) => {
		await signUp(page, "E2E Automations User");

		const ruleName = runName("invoices");
		const tagName = runSlug("invoice");

		const documentId = await ensureFreshFixtureDocument(page);

		// --- Settings → Automations (the gear of the sidebar footer) ----------
		await page.getByRole("link", { name: "Settings" }).first().click();
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
		await page.getByRole("link", { name: "Automations" }).first().click();
		await expect(page).toHaveURL(/\/settings\/automations$/);
		await expect(
			page.getByText("Cross-cutting rules", { exact: false }),
		).toBeVisible();

		await page.getByRole("link", { name: "New automation" }).click();
		await expect(
			page.getByRole("heading", { name: "New automation" }),
		).toBeVisible();

		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(ruleName);

		// Manual runs only: the development database is shared, an "ingest"
		// trigger would file the documents uploaded by the other specs.
		await page.getByRole("checkbox", { name: "On ingestion" }).click();
		await expect(
			page.getByRole("checkbox", { name: "On ingestion" }),
		).not.toBeChecked();

		await page.getByRole("button", { name: "Condition", exact: true }).click();
		await expect(
			page.getByRole("combobox", { name: "Condition field" }),
		).toBeVisible();
		await page
			.getByRole("textbox", { name: "Value", exact: true })
			.fill("facture");

		// `set_category` left the editor: filing a recurring document is the job
		// of a document type. A tag is what a cross-cutting rule does.
		await page.getByRole("combobox", { name: "Add an action" }).click();
		await chooseOption(page, "Add a tag");
		await page
			.getByRole("combobox", { name: "Tag", exact: true })
			.fill(tagName);
		await chooseOption(page, `Create tag "${tagName}"`);
		await expect(
			page.getByText(tagName, { exact: true }).first(),
		).toBeVisible();

		await page.getByRole("button", { name: "Create automation" }).click();
		await expect(page).toHaveURL(/\/settings\/automations\/rul_/);
		await expect(page.getByRole("heading", { name: ruleName })).toBeVisible();

		// --- Test against the fixture ------------------------------------------
		await page.getByRole("button", { name: "Document", exact: true }).click();
		await chooseOption(page, "text-layer");
		await page.getByRole("button", { name: "Test", exact: true }).click();

		await expect(page.getByTestId("rule-test-matched")).toHaveText("matched");
		await expect(page.getByTestId("condition-trace")).toContainText("facture");
		await expect(page.getByTestId("planned-actions")).toContainText(tagName);

		// --- Apply it for real --------------------------------------------------
		await page.getByRole("button", { name: "Run on this document" }).click();
		await expect(page.getByText(/\d+ of \d+ documents? matched/)).toBeVisible();

		await page.goto(`/documents/${documentId}`);
		await expect(page.getByText(tagName).first()).toBeVisible({
			timeout: 20_000,
		});

		// --- The old address still lands on the new one -------------------------
		await page.goto("/rules");
		await expect(page).toHaveURL(/\/settings\/automations$/);

		// --- Clean up: the development database is shared ------------------------
		await page.getByRole("link", { name: new RegExp(ruleName) }).click();
		await page.getByRole("button", { name: "Delete" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete" })
			.click();
		await expect(page).toHaveURL(/\/settings\/automations$/);
		await expect(
			page.getByRole("link", { name: new RegExp(ruleName) }),
		).toHaveCount(0);
	});

	test("create and test an extraction rule from the layout of a document type", async ({
		page,
	}) => {
		await signUp(page, "E2E Extraction User");

		const typeName = runName("extraction type");
		const extractionName = runName("invoice total");

		await ensureFreshFixtureDocument(page);

		// --- A minimal document type; it opens with its "Default" layout --------
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

		await page.getByRole("link", { name: typeName }).click();
		await expect(page).toHaveURL(/\/types\/dty_/);
		const typeUrl = page.url();

		// --- Layouts tab: the lone default layout shows its rules directly ------
		await page.getByRole("tab", { name: "Layouts" }).click();
		// The lone default layout is hidden: its rules are shown as such.
		await expect(
			page.getByText("Add a layout when the document"),
		).toBeVisible();

		await page.getByRole("button", { name: "Add extraction rule" }).click();
		await expect(page).toHaveURL(/\/types\/dty_[^/]+\/extraction\/new/);
		await expect(
			page.getByRole("heading", { name: "New extraction rule" }),
		).toBeVisible();

		// --- "Net à payer" → the total amount field ------------------------------
		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(extractionName);
		await page.getByRole("combobox", { name: "Custom field" }).click();
		await chooseOption(page, TOTAL_AMOUNT_FIELD);

		await page.getByRole("tab", { name: "Anchor" }).click();
		await page
			.getByRole("textbox", { name: "Label regex" })
			.fill("Net à payer");
		await page.getByRole("combobox", { name: "Position" }).click();
		await chooseOption(page, "To the right of the label");

		await page
			.getByRole("combobox", { name: "Add a post-processing step" })
			.click();
		await chooseOption(page, /^French number/);

		await page.getByRole("button", { name: "Document", exact: true }).click();
		await chooseOption(page, "text-layer");
		await page.getByRole("button", { name: "Test", exact: true }).click();

		await expect(page.getByTestId("extraction-value")).toHaveText("1234.56");

		await page.getByRole("button", { name: "Create extraction rule" }).click();
		await expect(page).toHaveURL(/\/types\/dty_[^/]+\/extraction\/ext_/, {
			timeout: 20_000,
		});

		// --- Back on the layout, the rule is listed ------------------------------
		await page.goto(`${typeUrl}?tab=layouts`);
		await expect(
			page.getByRole("link", { name: extractionName }),
		).toBeVisible();

		// --- Clean up: deleting the type takes its layout and rules with it ------
		await page.getByRole("button", { name: "Delete" }).first().click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete" })
			.click();
		await expect(page).toHaveURL(/\/types$/);
	});
});
