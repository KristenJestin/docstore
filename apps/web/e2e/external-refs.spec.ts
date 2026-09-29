import { expect, test } from "@playwright/test";

import { signUp } from "./helpers/auth";
import { API_KEY_ENV, apiClient, e2eBaseUrl } from "./helpers/cleanup";
import { ensureFreshFixtureDocument } from "./helpers/fixture-document";

/**
 * Issue #4, "How we will know it is done": an agent adds a wiki reference
 * through the API; the document page shows it in "Referenced by", and
 * `notReferencedBy: "wiki"` no longer lists the document.
 */
test.describe("external references", () => {
	test.slow();

	test("a wiki reference set by an agent shows on the document page", async ({
		page,
	}) => {
		const secret = process.env[API_KEY_ENV];
		if (!secret) throw new Error(`${API_KEY_ENV} is not set by the setup.`);
		const api = apiClient(e2eBaseUrl(), secret);

		await signUp(page, "E2E External Refs User");
		const documentId = await ensureFreshFixtureDocument(page);

		const ref = "10-admin/12-logement/contrat-edf.md";
		await api.document.setExternalRefs({
			id: documentId,
			system: "wiki",
			refs: [
				{
					ref,
					label: "Contrat EDF",
					url: "https://wiki.example.test/contrat-edf",
				},
			],
		});

		await page.goto(`/documents/${documentId}`);
		const card = page
			.locator('[data-slot="card"]')
			.filter({ hasText: "Referenced by" });
		await expect(
			card.getByRole("link", { name: "Contrat EDF" }),
		).toHaveAttribute("href", "https://wiki.example.test/contrat-edf");
		await expect(card.getByText(ref)).toBeVisible();
		await expect(card.getByText("wiki", { exact: true })).toBeVisible();

		const uncited = await api.document.list({
			notReferencedBy: "wiki",
			pageSize: 100,
		});
		expect(uncited.items.map((item) => item.id)).not.toContain(documentId);

		// Clearing the wiki's references brings the empty state back.
		await api.document.setExternalRefs({
			id: documentId,
			system: "wiki",
			refs: [],
		});
		await page.reload();
		await expect(
			page.getByText("No external note references this document yet."),
		).toBeVisible();
	});
});
