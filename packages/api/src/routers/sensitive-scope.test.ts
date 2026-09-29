import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { document, documentFile } from "@docstore/db/schema/document";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import {
	type ApiKeyScope,
	SENSITIVE_PLACEHOLDER,
} from "@docstore/shared/api-key";
import {
	createTestClient,
	createTestUser,
	expectOrpcError,
	type TestUser,
} from "../test-utils";

/**
 * API key scopes on every surface (issue #1, SPEC §6), oRPC side: `read` gates
 * every read procedure, `sensitive` gates the content of a sensitive document
 * (OCR text, OCR layout, dry runs over the OCR layer). A browser session keeps
 * every right.
 */

let db: TestDb;
let owner: TestUser;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
	owner = await createTestUser(db);
});

function keyClient(scopes: ApiKeyScope[]) {
	return createTestClient(db, owner, { id: "key_test", scopes });
}

async function seedDocument(
	title: string,
	options: { sensitive: boolean },
): Promise<{ id: string; fileId: string }> {
	const rows = await db
		.insert(document)
		.values({
			title,
			status: "active",
			createdById: owner.id,
			sensitive: options.sensitive,
			content: `OCR text of ${title}`,
		})
		.returning({ id: document.id });
	const id = rows[0]?.id;
	if (!id) throw new Error("document not inserted");
	const files = await db
		.insert(documentFile)
		.values({
			documentId: id,
			kind: "original",
			filename: `${title}.pdf`,
			mime: "application/pdf",
			size: 1024,
			sha256: `${id}-original`,
			storageKey: `docs/${id}/original.pdf`,
			pageCount: 1,
			encrypted: options.sensitive,
			ocrLayout: {
				pages: [
					{
						width: 100,
						height: 200,
						words: [{ text: "iban", x0: 1, y0: 2, x1: 3, y1: 4, conf: 0.9 }],
					},
				],
			},
		})
		.returning({ id: documentFile.id });
	const fileId = files[0]?.id;
	if (!fileId) throw new Error("file not inserted");
	return { id, fileId };
}

describe("Docstore SHALL reject every read procedure for an API key without the read scope", () => {
	test("WHEN a key with only write calls document.list THEN the response is 403 FORBIDDEN", async () => {
		const error = await expectOrpcError(
			keyClient(["write"]).document.list({}),
			"FORBIDDEN",
		);
		expect(error.status).toBe(403);
	});

	test("the other read procedures are refused the same way", async () => {
		const { id } = await seedDocument("Invoice", { sensitive: false });
		const client = keyClient(["write"]);
		await expectOrpcError(client.document.get({ id }), "FORBIDDEN");
		await expectOrpcError(client.party.list({}), "FORBIDDEN");
		await expectOrpcError(client.tag.list({}), "FORBIDDEN");
		await expectOrpcError(client.apiKey.list({}), "FORBIDDEN");
	});

	test("a key with read lists documents", async () => {
		await seedDocument("Invoice", { sensitive: false });
		const page = await keyClient(["read"]).document.list({});
		expect(page.total).toBe(1);
	});

	test("a key with only write still writes", async () => {
		const { id } = await seedDocument("Invoice", { sensitive: false });
		const updated = await keyClient(["write"]).document.update({
			id,
			title: "Renamed",
		});
		expect(updated.title).toBe("Renamed");
	});
});

describe("Docstore SHALL mask content in document.get for a sensitive document when the API key lacks sensitive", () => {
	test("WHEN a key with read only gets a sensitive document THEN content is the MCP placeholder and masked is true", async () => {
		const { id } = await seedDocument("Payslip", { sensitive: true });
		const detail = await keyClient(["read"]).document.get({ id });
		expect(detail.content).toBe(SENSITIVE_PLACEHOLDER);
		expect(detail.masked).toBe(true);
		expect(detail.title).toBe("Payslip");
		expect(detail.sensitive).toBe(true);
	});

	test("WHEN the same key gets a non-sensitive document THEN content is served", async () => {
		const { id } = await seedDocument("Invoice", { sensitive: false });
		const detail = await keyClient(["read"]).document.get({ id });
		expect(detail.content).toBe("OCR text of Invoice");
		expect(detail.masked).toBe(false);
	});

	test("WHEN a key with read + sensitive gets a sensitive document THEN content is served", async () => {
		const { id } = await seedDocument("Payslip", { sensitive: true });
		const detail = await keyClient(["read", "sensitive"]).document.get({ id });
		expect(detail.content).toBe("OCR text of Payslip");
		expect(detail.masked).toBe(false);
	});

	test("document.byAsn and the writes that return the document mask it too", async () => {
		const { id } = await seedDocument("Payslip", { sensitive: true });
		await db.update(document).set({ asn: 7 });
		expect((await keyClient(["read"]).document.byAsn({ asn: 7 })).content).toBe(
			SENSITIVE_PLACEHOLDER,
		);
		const updated = await keyClient(["write"]).document.update({
			id,
			title: "Payslip 2026",
		});
		expect(updated.content).toBe(SENSITIVE_PLACEHOLDER);
		expect(updated.masked).toBe(true);
	});
});

describe("Docstore SHALL refuse document.getFileLayout for a file of a sensitive document to an API key without sensitive", () => {
	test("WHEN a key with read only asks the layout of a sensitive file THEN the response is 403", async () => {
		const { fileId } = await seedDocument("Payslip", { sensitive: true });
		const error = await expectOrpcError(
			keyClient(["read"]).document.getFileLayout({ fileId }),
			"FORBIDDEN",
		);
		expect(error.status).toBe(403);
	});

	test("WHEN the same key asks the layout of a non-sensitive file THEN it is served", async () => {
		const { fileId } = await seedDocument("Invoice", { sensitive: false });
		const layout = await keyClient(["read"]).document.getFileLayout({
			fileId,
		});
		expect(layout.ocrLayout?.pages[0]?.words[0]?.text).toBe("iban");
	});

	test("WHEN a key with read + sensitive asks the layout of a sensitive file THEN it is served", async () => {
		const { fileId } = await seedDocument("Payslip", { sensitive: true });
		const layout = await keyClient([
			"read",
			"sensitive",
		]).document.getFileLayout({ fileId });
		expect(layout.ocrLayout?.pages[0]?.words[0]?.text).toBe("iban");
	});
});

describe("dry runs over the OCR layer follow the same rule", () => {
	test("extractionRule.preview of a sensitive document is refused to a key without sensitive", async () => {
		const { id } = await seedDocument("Payslip", { sensitive: true });
		await expectOrpcError(
			keyClient(["read"]).extractionRule.preview({ documentId: id }),
			"FORBIDDEN",
		);
	});

	test("rule.test on a sensitive document is refused to a key without sensitive", async () => {
		const { id } = await seedDocument("Payslip", { sensitive: true });
		await expectOrpcError(
			keyClient(["read"]).rule.test({
				documentId: id,
				rule: {
					name: "Draft",
					condition: { field: "content", cmp: "icontains", value: "iban" },
					actions: [],
				},
			}),
			"FORBIDDEN",
		);
	});
});

describe("A browser session SHALL keep every right", () => {
	test("the session reads the text and the layout of a sensitive document", async () => {
		const { id, fileId } = await seedDocument("Payslip", { sensitive: true });
		const client = createTestClient(db, owner);
		const detail = await client.document.get({ id });
		expect(detail.content).toBe("OCR text of Payslip");
		expect(detail.masked).toBe(false);
		const layout = await client.document.getFileLayout({ fileId });
		expect(layout.documentId).toBe(id);
		const preview = await client.extractionRule.preview({ documentId: id });
		expect(preview.fileId).toBe(fileId);
	});
});
