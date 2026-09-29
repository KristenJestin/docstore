import { addDays, todayIso } from "@docstore/shared/recurrence";
import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { API_KEY_ENV, apiClient, e2eBaseUrl, runName } from "./helpers/cleanup";
import { ensureFreshFixtureDocument } from "./helpers/fixture-document";

/** Where the screenshots of the run go (`E2E_SHOTS_DIR`), none when unset. */
const SHOTS_DIR = process.env.E2E_SHOTS_DIR;

/** next-themes keeps the choice in `localStorage.theme`; dark is the default. */
async function useTheme(page: Page, theme: "light" | "dark"): Promise<void> {
	await page.evaluate((value) => localStorage.setItem("theme", value), theme);
	await page.reload();
}

/**
 * Issue #33, "How we will know it is done": a date field `warrantyEnd` marked
 * "remind me"; a document with its warranty ending in 60 days gets a D-30 and
 * a D-7 reminder; changing the date moves them; trashing the document takes
 * them away.
 */
test.describe("date field reminders", () => {
	test.slow();

	test("a date field marked remind me raises reminders for a document", async ({
		page,
	}) => {
		const secret = process.env[API_KEY_ENV];
		if (!secret) throw new Error(`${API_KEY_ENV} is not set by the setup.`);
		const api = apiClient(e2eBaseUrl(), secret);

		await signUp(page, "E2E Date Field Reminders User");

		// --- The field: type "Date", "Remind me" on ---------------------------
		const fieldName = runName("warranty end");
		await page.goto("/settings/custom-fields");
		await page.getByRole("button", { name: "New field" }).first().click();
		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill(fieldName);
		await page.getByRole("combobox", { name: "Type" }).click();
		await page.getByRole("option", { name: "Date", exact: true }).click();

		const remind = page.getByRole("switch", { name: "Remind me" });
		await expect(remind).not.toBeChecked();
		await remind.click();
		await expect(remind).toBeChecked();
		await expect(page.getByLabel("Days of notice")).toBeVisible();
		await page.getByRole("button", { name: "Create field" }).click();
		await expect(page.getByText(fieldName, { exact: true })).toBeVisible();

		if (SHOTS_DIR) {
			for (const theme of ["dark", "light"] as const) {
				await useTheme(page, theme);
				await page.getByRole("button", { name: `Edit ${fieldName}` }).click();
				await expect(
					page.getByRole("switch", { name: "Remind me" }),
				).toBeChecked();
				// Let the sheet finish sliding in.
				await page.waitForTimeout(500);
				await page.screenshot({
					path: `${SHOTS_DIR}/field-sheet-${theme}.png`,
				});
				await page.keyboard.press("Escape");
			}
			await useTheme(page, "dark");
		}

		const fields = await api.customField.list({});
		const field = fields.find((item) => item.name === fieldName);
		expect(field?.options).toMatchObject({ remind: true });
		const fieldId = field?.id ?? "";

		// --- A document whose warranty ends in 60 days -----------------------
		const documentId = await ensureFreshFixtureDocument(page);
		const warrantyEnd = addDays(todayIso(), 60);
		await api.document.setFieldValue({
			id: documentId,
			fieldId,
			value: { kind: "date", date: warrantyEnd },
		});

		const listed = async () =>
			(await api.reminder.list({ kind: "field_date", limit: 500 })).filter(
				(item) => item.documentId === documentId,
			);
		expect((await listed()).map((item) => item.daysBefore)).toEqual([30, 7]);

		await page.goto("/reminders");
		const section = page.locator("section").filter({ hasText: "Date fields" });
		const rows = section.locator("li").filter({ hasText: fieldName });
		await expect(rows).toHaveCount(2);
		await expect(rows.first()).toContainText("reminder at D-30");
		await expect(rows.last()).toContainText("reminder at D-7");
		if (SHOTS_DIR) {
			for (const theme of ["dark", "light"] as const) {
				await useTheme(page, theme);
				await expect(rows).toHaveCount(2);
				await page.screenshot({
					path: `${SHOTS_DIR}/reminders-${theme}.png`,
					fullPage: true,
				});
			}
			await useTheme(page, "dark");
		}

		// --- Changing the date moves them ------------------------------------
		const later = addDays(warrantyEnd, 200);
		await api.document.setFieldValue({
			id: documentId,
			fieldId,
			value: { kind: "date", date: later },
		});
		const moved = await listed();
		expect(moved.map((item) => item.daysBefore)).toEqual([90, 30, 7]);
		expect(moved.every((item) => item.fieldDate === later)).toBe(true);

		// --- Trashing the document takes them away ---------------------------
		await api.document.trash({ id: documentId });
		expect(await listed()).toHaveLength(0);
		await page.reload();
		await expect(page.locator("li").filter({ hasText: fieldName })).toHaveCount(
			0,
		);
	});
});
