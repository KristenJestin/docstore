import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { runName, runSlug } from "./helpers/cleanup";
import {
	purgeExistingDocument,
	uploadFixture,
} from "./helpers/fixture-document";

/**
 * The ingestion pipeline really runs (pdftotext / Tesseract): the document
 * stays "processing" for a few seconds after the upload.
 */
const PROCESSING_TIMEOUT_MS = 60_000;

test.describe("documents", () => {
	test.slow();

	test("upload a PDF, enrich it, find it again, trash it then restore it", async ({
		page,
	}) => {
		await signUp(page, "E2E Documents User");

		// The development database is not reset: every fixture carries the prefix
		// of the run, which the global teardown sweeps away afterwards.
		const partyName = runName("energie cooperative");
		const tagName = runSlug("energie");
		const newTitle = runName("facture energie");

		// --- A party to link later -------------------------------------------
		await page.getByRole("link", { name: "Parties" }).first().click();
		await page.getByRole("button", { name: "New party" }).first().click();
		const partySheet = page.getByRole("dialog");
		await partySheet
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(partyName);
		await partySheet.getByRole("button", { name: "Create party" }).click();
		await expect(page.getByRole("heading", { name: partyName })).toBeVisible();

		// --- PDF upload ------------------------------------------------------
		await page.getByRole("link", { name: "Documents" }).first().click();
		await expect(
			page.getByRole("heading", { name: "Documents" }),
		).toBeVisible();

		// The sidebar counter has to follow the upload on its own. The marker
		// dropped on `window` is gone the moment the document reloads, so
		// nothing below can be passing thanks to a full page load.
		const navCount = page.getByTestId("nav-count-documents");
		await page.evaluate(() => {
			(window as Window & { __noReload?: true }).__noReload = true;
		});

		let documentsBefore = await settledDocumentCount(page);
		let outcome = await uploadFixture(page);
		if (outcome !== "created") {
			await purgeExistingDocument(page);
			documentsBefore = await settledDocumentCount(page);
			outcome = await uploadFixture(page);
		}
		expect(outcome).toBe("created");

		// Once every file settled the footer offers a single "Done" button.
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Done" })
			.first()
			.click();

		await expect(navCount).toHaveText(String(documentsBefore + 1), {
			timeout: 30_000,
		});
		expect(
			await page.evaluate(
				() => (window as Window & { __noReload?: true }).__noReload,
			),
		).toBe(true);

		// --- Leaving the "processing" state (the list polls) -----------------
		const row = page.getByRole("button", { name: "Open text-layer" });
		await expect(row).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText("Processing", { exact: true })).toHaveCount(0, {
			timeout: PROCESSING_TIMEOUT_MS,
		});

		// --- Detail page: OCR text -------------------------------------------
		await row.click();
		await expect(page).toHaveURL(/\/documents\/doc_/);
		await page.getByRole("tab", { name: "Text" }).click();
		await expect(page.getByTestId("document-ocr-text")).toContainText(
			"FACTURE",
			{ timeout: PROCESSING_TIMEOUT_MS },
		);

		// --- Inline editable title -------------------------------------------
		await page.getByRole("button", { name: "Edit title" }).click();
		const titleInput = page.getByRole("textbox", {
			name: "Document title",
		});
		await titleInput.fill(newTitle);
		await titleInput.press("Enter");
		await expect(page.getByRole("button", { name: "Edit title" })).toHaveText(
			newTitle,
		);

		// --- Issuing party ----------------------------------------------------
		await page.getByRole("button", { name: "Link a party" }).click();
		await page.getByRole("combobox", { name: "Party to link" }).fill(partyName);
		await page.getByRole("option", { name: partyName }).click();
		await page.getByRole("combobox", { name: "Party role" }).click();
		await page.getByRole("option", { name: "Issuer" }).click();
		await page.getByRole("button", { name: "Link", exact: true }).click();
		await expect(page.getByRole("link", { name: partyName })).toBeVisible();
		await expect(page.getByText("Issuer", { exact: true })).toBeVisible();

		// --- Category ----------------------------------------------------------
		// The seeded taxonomy is in English ("Invoice"); only the slugs and the
		// document text stay French. The field may already hold that category
		// when an ingestion rule filed the document, so the list is opened by
		// typing rather than by `fill`, which would write an identical value and
		// never open the popup.
		const categoryCombobox = page.getByRole("combobox", { name: "Category" });
		await categoryCombobox.click();
		await categoryCombobox.fill("");
		await categoryCombobox.pressSequentially("Invoice");
		await page
			.getByRole("option", { name: /^Invoice/ })
			.first()
			.click();
		await expect(categoryCombobox).toHaveValue(/Invoice/);

		// --- Tag created on the fly --------------------------------------------
		// `TagInput` is a single field: typing filters `tag.list` and the last row
		// of the dropdown creates the tag.
		await page
			.getByRole("combobox", { name: "Tags", exact: true })
			.fill(tagName);
		await page.getByRole("option", { name: `Create tag "${tagName}"` }).click();
		await expect(page.getByText(tagName).first()).toBeVisible();

		// --- Free-text notes, in light Markdown --------------------------------
		await page.getByRole("button", { name: "Edit the notes" }).click();
		const notes = page.getByRole("textbox", { name: "Notes" });
		await notes.fill("Ask about the **thermostat**.\n\n- Contract 4471");
		// The field saves when it loses the focus, and goes back to reading mode.
		await notes.blur();
		await expect(page.getByText("Ask about the thermostat.")).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.locator("strong", { hasText: "thermostat" }),
		).toBeVisible();
		await expect(page.getByRole("listitem")).toContainText(["Contract 4471"]);

		// --- Full-text search ---------------------------------------------------
		await page.getByRole("link", { name: "Documents" }).first().click();
		const search = page.getByRole("searchbox", { name: "Search a document" });

		// The notes joined the index, next to the title and the OCR text.
		await search.fill("thermostat");
		await expect(
			page.getByRole("button", { name: `Open ${newTitle}` }),
		).toBeVisible({ timeout: 15_000 });

		await search.fill("facture");
		await expect(
			page.getByRole("button", { name: `Open ${newTitle}` }),
		).toBeVisible({ timeout: 15_000 });

		// --- Filter bar: "Add filter" → Category → Invoice ----------------------
		await page.getByTestId("add-filter").click();
		await page.getByRole("option", { name: "Category", exact: true }).click();
		await page
			.getByRole("option", { name: /^Invoice/ })
			.first()
			.click();

		const categoryPill = page.getByTestId("filter-pill-category");
		await expect(categoryPill).toContainText("Invoice");
		await expect(page).toHaveURL(/categoryId=cat_/);
		await expect(
			page.getByRole("button", { name: `Open ${newTitle}` }),
		).toBeVisible({ timeout: 15_000 });

		// A tag filter on top of it, then everything is cleared at once.
		await page.getByTestId("add-filter").click();
		await page.getByRole("option", { name: "Tags", exact: true }).click();
		await page.getByRole("option", { name: tagName }).first().click();
		await page.getByRole("button", { name: "Apply" }).click();
		await expect(page.getByTestId("filter-pill-tags")).toContainText(tagName);

		await page.getByRole("button", { name: "Clear all" }).click();
		await expect(categoryPill).toHaveCount(0);
		await expect(page).not.toHaveURL(/categoryId=/);

		// --- Trash then restore -------------------------------------------------
		await page.getByRole("button", { name: `Open ${newTitle}` }).click();
		await page.getByRole("button", { name: "Trash" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Move to trash" })
			.click();

		// Read-only mode: a banner explains it, and the metadata cannot be edited.
		const banner = page.getByTestId("trashed-banner");
		await expect(banner).toBeVisible();
		await expect(
			page.getByRole("textbox", { name: "Physical location" }),
		).toBeDisabled();

		await banner.getByRole("button", { name: "Restore" }).click();
		await expect(banner).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Trash" })).toBeVisible();
	});
});

/**
 * Sidebar "Documents" counter, read once two consecutive samples agree: a
 * purge leaves a refetch in flight and the first sample would still be the
 * count from before the deletion.
 */
async function settledDocumentCount(page: Page): Promise<number> {
	const counter = page.getByTestId("nav-count-documents");
	let previous = Number.NaN;
	await expect
		.poll(
			async () => {
				const current = Number((await counter.innerText()).trim());
				const settled = current === previous;
				previous = current;
				return settled;
			},
			{ timeout: 15_000, intervals: [400] },
		)
		.toBe(true);
	return previous;
}
