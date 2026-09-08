import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { updateCategoryInput } from "./category";
import { updateCustomFieldInput } from "./custom-field";
import { updateDocumentInput } from "./document";
import {
	updateDocumentTypeInput,
	updateDocumentTypeLayoutInput,
} from "./document-type";
import { updateDossierInput } from "./dossier";
import { updateExtractionRuleInput } from "./extraction";
import { updateIntakeSourceInput } from "./intake";
import { updatePartyInput } from "./party";
import { updateRuleInput } from "./rule";
import { updateSavedSearchInput } from "./saved-search";
import { updateTagInput } from "./tag";
import { updateUploadLinkInput } from "./upload-link";
import { updateWebhookInput } from "./webhook";

/**
 * Every update input is a patch: parsing one adds nothing to what was sent.
 *
 * A `.default()` surviving into an update schema is invisible until it lands in
 * the database — `.partial()` keeps the defaults, so renaming a document type
 * used to send `tagIds: []` along with the new name and empty its tags. This
 * table is the guard: one entry per update schema, each parsed from the
 * smallest patch it accepts.
 */
const UPDATE_INPUTS: [string, z.ZodType, Record<string, unknown>][] = [
	["updateCategoryInput", updateCategoryInput, { id: "cat_1", name: "Taxes" }],
	[
		"updateCustomFieldInput",
		updateCustomFieldInput,
		{ id: "cf_1", name: "Net paid" },
	],
	["updateDocumentInput", updateDocumentInput, { title: "Payslip" }],
	[
		"updateDocumentTypeInput",
		updateDocumentTypeInput,
		{ id: "dt_1", name: "EDF bill" },
	],
	[
		"updateDocumentTypeLayoutInput",
		updateDocumentTypeLayoutInput,
		{ id: "lay_1", name: "2025 layout" },
	],
	["updateDossierInput", updateDossierInput, { id: "dos_1", name: "Move" }],
	[
		"updateExtractionRuleInput",
		updateExtractionRuleInput,
		{ id: "ext_1", name: "Net paid" },
	],
	[
		"updateIntakeSourceInput",
		updateIntakeSourceInput,
		{ id: "int_1", name: "Mailbox" },
	],
	["updatePartyInput", updatePartyInput, { name: "EDF" }],
	["updateRuleInput", updateRuleInput, { id: "rul_1", name: "Tag the bills" }],
	[
		"updateSavedSearchInput",
		updateSavedSearchInput,
		{ id: "sea_1", name: "Late bills" },
	],
	["updateTagInput", updateTagInput, { id: "tag_1", name: "urgent" }],
	[
		"updateUploadLinkInput",
		updateUploadLinkInput,
		{ id: "upl_1", name: "Accountant" },
	],
	[
		"updateWebhookInput",
		updateWebhookInput,
		{ id: "whk_1", name: "Home Assistant" },
	],
];

describe("update inputs", () => {
	test.each(UPDATE_INPUTS)(
		"%s applies no default to an absent field",
		(_name, schema, patch) => {
			expect(schema.parse(patch)).toEqual(patch);
		},
	);
});

describe("updateDocumentTypeInput", () => {
	test("a rename carries the name alone", () => {
		const parsed = updateDocumentTypeInput.parse({
			id: "dt_1",
			name: "EDF electricity bill",
		});
		expect(Object.keys(parsed).sort()).toEqual(["id", "name"]);
		expect(parsed.tagIds).toBeUndefined();
		expect(parsed.sensitiveDefault).toBeUndefined();
		expect(parsed.paperOriginal).toBeUndefined();
	});

	test("a field explicitly sent is still read", () => {
		expect(
			updateDocumentTypeInput.parse({
				id: "dt_1",
				tagIds: ["tag_1"],
				sensitiveDefault: true,
			}),
		).toEqual({ id: "dt_1", tagIds: ["tag_1"], sensitiveDefault: true });
	});
});
