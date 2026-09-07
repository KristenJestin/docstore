import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { customField } from "@docstore/db/schema/custom-field";
import { document, documentFile } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { OcrLayout, OcrWord } from "@docstore/shared/document";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

let db: TestDb;
let owner: TestUser;
let client: ReturnType<typeof createTestClient>;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
	client = createTestClient(db, owner);
});

function word(text: string, x0: number, x1: number, y0: number): OcrWord {
	return { text, x0, x1, y0, y1: y0 + 20, conf: 100 };
}

/** Synthetic layer: "NET PAYABLE 1 234,56 €" on a single page. */
const LAYOUT: OcrLayout = {
	pages: [
		{
			width: 600,
			height: 800,
			words: [
				word("INVOICE", 60, 140, 100),
				word("NET", 60, 100, 200),
				word("PAYABLE", 105, 180, 200),
				word("1", 400, 410, 200),
				word("234,56", 415, 470, 200),
				word("€", 475, 485, 200),
			],
		},
	],
};

const CONTENT = "INVOICE\nNET PAYABLE 1 234,56 €";

async function seedDocumentWithLayout(): Promise<{
	documentId: string;
	fileId: string;
}> {
	const documents = await db
		.insert(document)
		.values({
			title: "EDF invoice",
			status: "active",
			content: CONTENT,
			createdById: owner.id,
		})
		.returning({ id: document.id });
	const documentId = documents[0]?.id ?? "";

	const files = await db
		.insert(documentFile)
		.values({
			documentId,
			kind: "original",
			filename: "invoice.pdf",
			mime: "application/pdf",
			size: 1024,
			sha256: `sha-${documentId}`,
			storageKey: `documents/${documentId}/original.pdf`,
			pageCount: 1,
			ocrLayout: LAYOUT,
		})
		.returning({ id: documentFile.id });
	return { documentId, fileId: files[0]?.id ?? "" };
}

/** A type and its Default layout: the only home of an extraction rule. */
async function seedLayout(): Promise<{
	documentTypeId: string;
	layoutId: string;
}> {
	const created = await client.documentType.create({ name: "EDF invoice" });
	const detail = await client.documentType.get({ id: created.id });
	return { documentTypeId: created.id, layoutId: detail.layouts[0]?.id ?? "" };
}

async function seedField(): Promise<string> {
	const rows = await db
		.insert(customField)
		.values({
			name: "Total amount",
			slug: "total-amount",
			type: "money",
			options: { currency: "EUR" },
		})
		.returning({ id: customField.id });
	return rows[0]?.id ?? "";
}

describe("extractionRule CRUD", () => {
	test("creates, lists, updates and deletes", async () => {
		const fieldId = await seedField();
		const { documentTypeId, layoutId } = await seedLayout();
		const created = await client.extractionRule.create({
			name: "Net payable",
			layoutId,
			target: { kind: "field", fieldId },
			strategy: {
				kind: "anchor",
				label: "NET PAYABLE",
				position: "sameLine",
				valuePattern: "(\\d[\\d\\s.,]*\\d)",
			},
			postprocess: ["number_fr"],
		});
		expect(created.id).toStartWith("ext_");
		expect(created.postprocess).toEqual(["number_fr"]);
		expect(created.layoutId).toBe(layoutId);

		expect(await client.extractionRule.list({ layoutId })).toHaveLength(1);
		expect(await client.extractionRule.list({ documentTypeId })).toHaveLength(
			1,
		);
		expect((await client.extractionRule.get({ id: created.id })).name).toBe(
			"Net payable",
		);

		const updated = await client.extractionRule.update({
			id: created.id,
			name: "Taxable net",
			postprocess: ["trim", "number_fr"],
		});
		expect(updated.name).toBe("Taxable net");
		expect(updated.postprocess).toEqual(["trim", "number_fr"]);

		expect(await client.extractionRule.delete({ id: created.id })).toEqual({
			id: created.id,
			deleted: true,
		});
	});

	test("a rule is optional unless it is told otherwise", async () => {
		const { layoutId } = await seedLayout();
		const created = await client.extractionRule.create({
			name: "Reference",
			layoutId,
			target: { kind: "title" },
			strategy: { kind: "regex", pattern: "Ref (\\w+)", group: 1 },
		});
		expect(created.required).toBe(false);

		const promoted = await client.extractionRule.update({
			id: created.id,
			required: true,
		});
		expect(promoted.required).toBe(true);
		expect((await client.extractionRule.get({ id: created.id })).required).toBe(
			true,
		);

		const demoted = await client.extractionRule.update({
			id: created.id,
			required: false,
		});
		expect(demoted.required).toBe(false);
	});

	test("requires a layout or a document type to list", async () => {
		await expectOrpcError(client.extractionRule.list({}), "BAD_REQUEST");
	});

	test("rejects a nonexistent layout", async () => {
		const { layoutId } = await seedLayout();
		await expectOrpcError(
			client.extractionRule.create({
				name: "X",
				layoutId: "dtl_absent",
				target: { kind: "title" },
				strategy: { kind: "regex", pattern: "x", group: 1 },
			}),
			"NOT_FOUND",
		);
		const created = await client.extractionRule.create({
			name: "X",
			layoutId,
			target: { kind: "title" },
			strategy: { kind: "regex", pattern: "x", group: 1 },
		});
		await expectOrpcError(
			client.extractionRule.update({ id: created.id, layoutId: "dtl_absent" }),
			"NOT_FOUND",
		);
	});

	test("rejects a nonexistent field target", async () => {
		const { layoutId } = await seedLayout();
		await expectOrpcError(
			client.extractionRule.create({
				name: "X",
				layoutId,
				target: { kind: "field", fieldId: "cf_absent" },
				strategy: { kind: "regex", pattern: "x", group: 1 },
			}),
			"NOT_FOUND",
		);
	});

	test("rejects an overly long pattern", async () => {
		const { layoutId } = await seedLayout();
		await expectOrpcError(
			client.extractionRule.create({
				name: "X",
				layoutId,
				target: { kind: "title" },
				strategy: { kind: "regex", pattern: "a".repeat(501), group: 1 },
			}),
			"BAD_REQUEST",
		);
	});

	test("404 on an unknown rule", async () => {
		await expectOrpcError(
			client.extractionRule.get({ id: "ext_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("extractionRule.applicable", () => {
	test("returns the rules of the layout carried by the document", async () => {
		const { documentTypeId, layoutId } = await seedLayout();
		await client.extractionRule.create({
			name: "Net payable",
			layoutId,
			target: { kind: "title" },
			strategy: { kind: "regex", pattern: "NET PAYABLE ([\\d\\s.,]+)" },
		});
		const { documentId } = await seedDocumentWithLayout();

		// No type yet: nothing to offer.
		expect(await client.extractionRule.applicable({ documentId })).toEqual([]);

		await client.documentType.apply({
			documentTypeId,
			documentIds: [documentId],
		});
		const applicable = await client.extractionRule.applicable({ documentId });
		expect(applicable.map((rule) => rule.name)).toEqual(["Net payable"]);
	});

	test("404 on an unknown document", async () => {
		await expectOrpcError(
			client.extractionRule.applicable({ documentId: "doc_absent" }),
			"NOT_FOUND",
		);
	});
});

describe("extractionRule.test", () => {
	test("tries an anchor draft on the document layer", async () => {
		const { documentId } = await seedDocumentWithLayout();

		const result = await client.extractionRule.test({
			documentId,
			rule: {
				name: "Draft",
				target: { kind: "title" },
				strategy: {
					kind: "anchor",
					label: "NET PAYABLE",
					position: "sameLine",
					valuePattern: "(\\d[\\d\\s.,]*\\d)",
				},
				postprocess: ["number_fr"],
			},
		});

		expect(result.raw).toBe("1 234,56");
		expect(result.value).toBe(1234.56);
		expect(result.confidence).toBe(1);
		expect(result.matchedWords?.map((box) => box.text)).toEqual([
			"1",
			"234,56",
		]);
	});

	test("tries a persisted rule", async () => {
		const { documentId } = await seedDocumentWithLayout();
		const fieldId = await seedField();
		const { layoutId } = await seedLayout();
		const created = await client.extractionRule.create({
			name: "Net payable",
			layoutId,
			target: { kind: "field", fieldId },
			strategy: {
				kind: "regex",
				pattern: "NET PAYABLE ([\\d\\s.,]+)",
				group: 1,
			},
			postprocess: ["trim", "number_fr"],
		});

		const result = await client.extractionRule.test({
			documentId,
			extractionRuleId: created.id,
		});
		expect(result.value).toBe(1234.56);
		expect(result.confidence).toBe(0.8);
	});

	test("returns an empty result when nothing matches", async () => {
		const { documentId } = await seedDocumentWithLayout();
		const result = await client.extractionRule.test({
			documentId,
			rule: {
				name: "Draft",
				target: { kind: "title" },
				strategy: { kind: "regex", pattern: "NOTFOUND", group: 0 },
				postprocess: [],
			},
		});
		expect(result.raw).toBeNull();
		expect(result.confidence).toBe(0);
	});

	test("404 on an unknown document", async () => {
		await expectOrpcError(
			client.extractionRule.test({
				documentId: "doc_absent",
				rule: {
					name: "X",
					target: { kind: "title" },
					strategy: { kind: "regex", pattern: "x", group: 0 },
					postprocess: [],
				},
			}),
			"NOT_FOUND",
		);
	});
});

describe("extractionRule.preview", () => {
	test("returns the rebuilt lines of the layer", async () => {
		const { documentId, fileId } = await seedDocumentWithLayout();
		const preview = await client.extractionRule.preview({
			documentId,
			fileId,
		});
		expect(preview.fileId).toBe(fileId);
		expect(preview.pageCount).toBe(1);
		expect(preview.lines).toEqual([
			{ page: 0, y: 100, text: "INVOICE" },
			{ page: 0, y: 200, text: "NET PAYABLE 1 234,56 €" },
		]);
	});

	test("404 when the document has no file", async () => {
		const rows = await db
			.insert(document)
			.values({ title: "No file", createdById: owner.id })
			.returning({ id: document.id });
		await expectOrpcError(
			client.extractionRule.preview({ documentId: rows[0]?.id ?? "" }),
			"NOT_FOUND",
		);
	});
});
