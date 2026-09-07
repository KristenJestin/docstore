import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName } from "./helpers/cleanup";
import {
	ensureFreshFixtureDocument,
	INVOICE_SIRET_FIXTURE,
} from "./helpers/fixture-document";

/** Picks the first entry of a `Select` / `Combobox` that is already open. */
async function chooseFirstOption(page: Page): Promise<void> {
	await page.getByRole("option").first().click();
}

/** Creates a party and returns its name (the dev database is never reset). */
async function createParty(page: Page, name: string): Promise<string> {
	await page.getByRole("link", { name: "Parties" }).first().click();
	await expect(page.getByRole("heading", { name: "Parties" })).toBeVisible();
	await page.getByRole("button", { name: "New party" }).first().click();

	const sheet = page.getByRole("dialog");
	await sheet.getByRole("textbox", { name: "Name", exact: true }).fill(name);
	await sheet.getByRole("button", { name: "Create party" }).click();
	await expect(page).toHaveURL(/\/parties\/[^/]+$/);
	return name;
}

test.describe("organisation", () => {
	test.slow();

	test("create a recurring document type with an issuer and a category", async ({
		page,
	}) => {
		await signUp(page, "E2E Types User");

		const partyName = runName("type party");
		const typeName = runName("electricity");

		await createParty(page, partyName);

		await page.getByRole("link", { name: "Document types" }).first().click();
		await expect(
			page.getByRole("heading", { name: "Document types" }),
		).toBeVisible();

		await page
			.getByRole("button", { name: "New document type" })
			.first()
			.click();
		const sheet = page.getByRole("dialog");
		await expect(
			sheet.getByRole("heading", { name: "New document type" }),
		).toBeVisible();

		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(typeName);

		await sheet.getByRole("combobox", { name: "Issuer" }).fill(partyName);
		await chooseFirstOption(page);

		await sheet.getByRole("combobox", { name: "Category" }).click();
		await chooseFirstOption(page);

		// Recurrence: the former Series, now a block of the type.
		await sheet.getByRole("switch", { name: "Recurring document" }).click();
		await expect(
			sheet.getByRole("combobox", { name: "Periodicity" }),
		).toBeVisible();

		await sheet.getByRole("button", { name: "Create document type" }).click();

		// --- Presence in the list -------------------------------------------
		await expect(sheet).toBeHidden();
		await expect(
			page.getByRole("link", { name: typeName }).first(),
		).toBeVisible();

		// --- "Recurring" filter, which replaced the Series page ----------------
		await page.getByTestId("add-filter").click();
		await page.getByRole("option", { name: "Recurring", exact: true }).click();
		await page.getByRole("option", { name: "Yes", exact: true }).click();
		await expect(page).toHaveURL(/recurring=true/);
		await expect(
			page.getByRole("link", { name: typeName }).first(),
		).toBeVisible();

		// --- Detail page ------------------------------------------------------
		await page.getByRole("link", { name: typeName }).first().click();
		await expect(page).toHaveURL(/\/types\/[^/]+/);
		await expect(page.getByRole("heading", { name: typeName })).toBeVisible();
		await expect(page.getByTestId("recurrence-timeline")).toBeVisible();
	});

	test("/series redirects to the recurring document types", async ({
		page,
	}) => {
		await signUp(page, "E2E Series Redirect User");

		await page.goto("/series");
		await expect(page).toHaveURL(/\/types\?.*recurring=true/);
		await expect(
			page.getByRole("heading", { name: "Document types" }),
		).toBeVisible();
	});

	test("create a dossier, add a document and share it publicly", async ({
		page,
		browser,
	}) => {
		await signUp(page, "E2E Dossier User");

		const dossierName = runName("move");

		await ensureFreshFixtureDocument(page);

		// --- Creation ---------------------------------------------------------
		await page.getByRole("link", { name: "Dossiers" }).first().click();
		await expect(page.getByRole("heading", { name: "Dossiers" })).toBeVisible();
		await page.getByRole("button", { name: "New dossier" }).first().click();

		const sheet = page.getByRole("dialog");
		await sheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(dossierName);
		await sheet.getByRole("button", { name: "Create dossier" }).click();
		await expect(sheet).toBeHidden();

		// Creating a dossier lands straight on its detail page, like parties.
		await expect(page).toHaveURL(/\/dossiers\/[^/]+$/);
		await expect(
			page.getByRole("heading", { name: dossierName }),
		).toBeVisible();

		// --- Adding the fixture document --------------------------------------
		await page.getByRole("button", { name: "Add documents" }).first().click();
		const picker = page.getByRole("dialog");
		await expect(
			picker.getByRole("heading", { name: "Add documents" }),
		).toBeVisible();
		await picker
			.getByRole("searchbox", { name: "Search a document" })
			.fill("text-layer");
		await picker
			.getByRole("checkbox", { name: /^Select text-layer/ })
			.first()
			.click();
		await picker.getByRole("button", { name: /^Add 1 document/ }).click();
		await expect(picker).toBeHidden();

		await expect(
			page.getByRole("link", { name: /text-layer/ }).first(),
		).toBeVisible();

		// --- Share link -------------------------------------------------------
		await page.getByRole("button", { name: "Share this dossier" }).click();
		const share = page.getByRole("dialog");
		await expect(share.getByRole("heading", { name: "Share" })).toBeVisible();
		await share.getByRole("button", { name: "Create link" }).click();

		const url = await share.getByTestId("share-link-url").first().textContent();
		expect(url).toMatch(/\/s\/[A-Za-z0-9_-]+$/);

		// --- Public page, without any session ---------------------------------
		const anonymous = await browser.newContext();
		const publicPage = await anonymous.newPage();
		await publicPage.goto(url as string);
		await expect(
			publicPage.getByRole("heading", { name: dossierName }),
		).toBeVisible();
		await expect(publicPage.getByText("text-layer").first()).toBeVisible();
		await anonymous.close();
	});

	test("export preview and saved search", async ({ page }) => {
		await signUp(page, "E2E Export User");

		const searchName = runName("recent");

		await page.getByRole("link", { name: "Documents" }).first().click();
		await expect(
			page.getByRole("heading", { name: "Documents" }),
		).toBeVisible();

		// --- Export preview ---------------------------------------------------
		await page.getByRole("button", { name: "More actions" }).click();
		await page.getByRole("menuitem", { name: "Export…" }).click();

		const exportDialog = page.getByRole("dialog");
		await expect(
			exportDialog.getByRole("heading", { name: "Export" }),
		).toBeVisible();
		await expect(
			exportDialog.getByTestId("export-preview-count"),
		).toBeVisible();
		await expect
			.poll(
				async () =>
					Number(
						await exportDialog
							.getByTestId("export-preview-count")
							.textContent(),
					),
				{ timeout: 15_000 },
			)
			.toBeGreaterThanOrEqual(1);
		await exportDialog.getByRole("button", { name: "Cancel" }).click();
		await expect(exportDialog).toBeHidden();

		// --- Saving the current filters ---------------------------------------
		await page
			.getByRole("searchbox", { name: "Search a document" })
			.fill("facture");
		await expect(page).toHaveURL(/q=facture/);

		await page.getByRole("button", { name: "More actions" }).click();
		await page.getByRole("menuitem", { name: "Save search" }).click();

		const saveDialog = page.getByRole("dialog");
		await saveDialog
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(searchName);
		await saveDialog.getByRole("button", { name: "Save search" }).click();
		await expect(saveDialog).toBeHidden();

		// --- Reopening it from the sidebar ------------------------------------
		await page.getByRole("link", { name: "Parties" }).first().click();
		await expect(page).toHaveURL(/\/parties$/);

		await page.getByRole("button", { name: searchName }).first().click();
		await expect(page).toHaveURL(/\/documents\?/);
		await expect(
			page.getByRole("searchbox", { name: "Search a document" }),
		).toHaveValue("facture");
	});

	test("add a relation between two documents", async ({ page }) => {
		await signUp(page, "E2E Relations User");

		// Two distinct fixtures: the second one becomes the source of the link.
		await ensureFreshFixtureDocument(page);
		const secondId = await ensureFreshFixtureDocument(
			page,
			INVOICE_SIRET_FIXTURE,
		);

		await page.goto(`/documents/${secondId}`);
		await expect(page.getByText("Related documents")).toBeVisible();

		await page.getByRole("button", { name: "Add a relation" }).click();
		// Named on purpose: the document picker popover also carries role="dialog".
		const dialog = page.getByRole("dialog", { name: "Add a relation" });
		await expect(
			dialog.getByRole("heading", { name: "Add a relation" }),
		).toBeVisible();

		await dialog.getByRole("button", { name: "Other document" }).click();
		await page.getByPlaceholder("Search a document…").fill("text-layer");
		await page
			.getByRole("option", { name: /text-layer/ })
			.first()
			.click();

		await dialog.getByRole("button", { name: "Add relation" }).click();
		await expect(dialog).toBeHidden();

		await expect(
			page.getByRole("link", { name: /text-layer/ }).first(),
		).toBeVisible();
		await expect(page.getByText("related to").first()).toBeVisible();
	});
});
