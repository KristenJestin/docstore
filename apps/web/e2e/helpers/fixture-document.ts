import path from "node:path";
import { expect, type Page } from "@playwright/test";

/**
 * The OCR fixtures used by the document-centric specs. Their sha256 is unique
 * across the whole database, so a second upload comes back as a duplicate.
 *
 * Playwright runs from `apps/web` (`bun run test:e2e`).
 */
function fixture(name: string): string {
	return path.resolve(
		process.cwd(),
		`../../packages/ocr/test/fixtures/${name}`,
	);
}

export const TEXT_LAYER_FIXTURE = fixture("text-layer.pdf");
/** Second document, for the specs that need two of them (relations…). */
export const INVOICE_SIRET_FIXTURE = fixture("invoice-siret.pdf");

/** `…/text-layer.pdf` → `text-layer`, the label of the preview button. */
function fixtureLabel(file: string): string {
	return path.basename(file, path.extname(file));
}

export type UploadOutcome = "created" | "duplicate" | "trashed";

/** Uploads a fixture from `/documents` and reports what the server did. */
export async function uploadFixture(
	page: Page,
	file: string = TEXT_LAYER_FIXTURE,
): Promise<UploadOutcome> {
	await page.getByRole("button", { name: "Add", exact: true }).first().click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("heading", { name: "Add documents" }),
	).toBeVisible();

	// There is no "Upload" button any more: picking the file starts it.
	await dialog.locator('input[type="file"]').setInputFiles(file);
	await expect(dialog.getByText(path.basename(file))).toBeVisible();

	// The dialog polls the pipeline itself: the row only offers "Open" once the
	// document left `processing`, which is why the timeout is generous.
	const created = dialog.getByRole("button", { name: "Open", exact: true });
	const duplicate = dialog.getByRole("button", { name: "Open the original" });
	const trashed = dialog.getByRole("button", { name: "Restore" });
	await expect(created.or(duplicate).or(trashed)).toBeVisible({
		timeout: 60_000,
	});

	if ((await created.count()) > 0) {
		return "created";
	}
	return (await duplicate.count()) > 0 ? "duplicate" : "trashed";
}

/** Permanently deletes the copy already in the database, to start from scratch. */
export async function purgeExistingDocument(page: Page): Promise<void> {
	const dialog = page.getByRole("dialog");
	if ((await dialog.getByRole("button", { name: "Restore" }).count()) > 0) {
		await dialog.getByRole("button", { name: "Restore" }).click();
	}
	await dialog.getByRole("button", { name: "Open the original" }).click();
	await expect(page).toHaveURL(/\/documents\/doc_/);

	// The URL changes before `document.get` resolves: without this the header
	// actions are still a skeleton and the "Trash" probe below reads zero.
	await expect(
		page.getByRole("button", { name: "Reprocess" }).first(),
	).toBeVisible();

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

/**
 * Leaves a freshly ingested copy of the fixture in the database and returns its
 * identifier. The already present copy is purged first: the rule and extraction
 * tests need the newest document of the list.
 */
export async function ensureFreshFixtureDocument(
	page: Page,
	file: string = TEXT_LAYER_FIXTURE,
): Promise<string> {
	await page.getByRole("link", { name: "Documents" }).first().click();
	await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

	let outcome = await uploadFixture(page, file);
	if (outcome !== "created") {
		await purgeExistingDocument(page);
		outcome = await uploadFixture(page, file);
	}
	expect(outcome).toBe("created");

	const openLink = page
		.getByRole("dialog")
		.getByRole("button", { name: "Open", exact: true });
	const href = await openLink.getAttribute("href");
	// Once every file settled the footer offers a single "Done" button.
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Done" })
		.first()
		.click();

	const documentId = href?.split("/").pop() ?? "";
	expect(documentId).toMatch(/^doc_/);

	// The dialog already waited for the end of the pipeline; the list still has
	// to catch up before the row is clickable.
	await expect(
		page.getByRole("button", { name: `Open ${fixtureLabel(file)}` }),
	).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("processing", { exact: true })).toHaveCount(0, {
		timeout: 60_000,
	});

	return documentId;
}
