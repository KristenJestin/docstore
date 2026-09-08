import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { generateReminders } from "@docstore/api/services/reminder.service";
import { createId } from "@docstore/db/id";
import { category } from "@docstore/db/schema/category";
import { customField } from "@docstore/db/schema/custom-field";
import { document, documentParty } from "@docstore/db/schema/document";
import {
	documentType,
	documentTypeLayout,
} from "@docstore/db/schema/document-type";
import { dossier } from "@docstore/db/schema/dossier";
import { intakeSource } from "@docstore/db/schema/intake";
import { party } from "@docstore/db/schema/party";
import { extractionRule, rule } from "@docstore/db/schema/rule";
import { savedSearch } from "@docstore/db/schema/saved-search";
import { shareLink } from "@docstore/db/schema/share";
import { documentTag, tag } from "@docstore/db/schema/tag";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import {
	createTestIngestion,
	type TestIngestion,
} from "@docstore/ingestion/test-utils";
import {
	DOCUMENT_PARTY_ROLES,
	DOCUMENT_STATUSES,
} from "@docstore/shared/document";
import { EXPORT_LAYOUTS } from "@docstore/shared/export";
import { PARTY_IDENTIFIER_KINDS, PARTY_TYPES } from "@docstore/shared/party";
import {
	addMonths,
	periodStartOf,
	todayIso,
} from "@docstore/shared/recurrence";
import { DOCUMENT_RELATION_KINDS } from "@docstore/shared/relation";
import { eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { MCP_INSTRUCTIONS, MCP_SERVER_NAME } from "./server";
import {
	createMcpTestClient,
	insertTestUser,
	type McpTestHarness,
	TEXT_LAYER_PDF,
} from "./test-utils";
import { SENSITIVE_PLACEHOLDER } from "./tools-documents";

let db: TestDb;
let userId: string;
let ingestion: TestIngestion;
const harnesses: McpTestHarness[] = [];

beforeAll(async () => {
	db = await createTestDb();
	ingestion = await createTestIngestion(db);
});

afterAll(async () => {
	await ingestion.cleanup();
	await db.$client.end();
});

beforeEach(async () => {
	while (harnesses.length > 0) {
		await harnesses.pop()?.close();
	}
	await truncateAll(db);
	userId = await insertTestUser(db);
});

/** Opens an MCP client that is closed automatically at the next test. */
async function connect(
	scopes: Parameters<typeof createMcpTestClient>[0]["scopes"],
	options: { ingestion?: IngestionBinding } = {},
) {
	const harness = await createMcpTestClient({
		db,
		userId,
		scopes,
		ingestion: options.ingestion,
	});
	harnesses.push(harness);
	return harness.client;
}

interface SeededDocument {
	id: string;
	categoryId: string;
	tagId: string;
	partyId: string;
}

async function seedDocument(
	overrides: { title?: string; sensitive?: boolean; content?: string } = {},
): Promise<SeededDocument> {
	const categoryId = createId("cat_");
	await db.insert(category).values({
		id: categoryId,
		name: "Factures",
		slug: `factures-${categoryId}`,
	});

	const tagId = createId("tag_");
	await db.insert(tag).values({ id: tagId, name: `urgent-${tagId}` });

	const partyId = createId("prt_");
	await db.insert(party).values({
		id: partyId,
		type: "company",
		name: "EDF",
		identifiers: { siren: "552081317" },
	});

	const id = createId("doc_");
	await db.insert(document).values({
		id,
		title: overrides.title ?? "Facture électricité",
		status: "active",
		documentDate: "2026-01-15",
		datePrecision: "day",
		categoryId,
		sensitive: overrides.sensitive ?? false,
		content: overrides.content ?? "Facture EDF du 15 janvier 2026, 84,20 EUR",
		createdById: userId,
	});
	await db.insert(documentTag).values({ documentId: id, tagId });
	await db
		.insert(documentParty)
		.values({ documentId: id, partyId, role: "issuer" });

	return { id, categoryId, tagId, partyId };
}

/**
 * `callTool` returns a union (regular result or compatibility shape): the
 * helpers below extract from it what the tests observe.
 */
function structured<T>(result: unknown): T {
	return (result as { structuredContent?: unknown }).structuredContent as T;
}

function textOf(result: unknown): string {
	const blocks =
		(result as { content?: { type: string; text?: string }[] }).content ?? [];
	return blocks
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
}

function isToolError(result: unknown): boolean {
	return (result as { isError?: boolean }).isError === true;
}

/** Text content of a read resource (binary content is not tested here). */
function resourceText(result: unknown): string {
	const contents = (result as { contents: { text?: string }[] }).contents;
	return contents[0]?.text ?? "";
}

describe("handshake", () => {
	test("exposes the server name and its instructions", async () => {
		const client = await connect(["read"]);
		expect(client.getServerVersion()?.name).toBe(MCP_SERVER_NAME);
		expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
	});

	test("lists every expected tool", async () => {
		const client = await connect(["read"]);
		const { tools } = await client.listTools();
		const names = tools.map((tool) => tool.name).sort();

		expect(names).toEqual(
			[
				"add_document_relation",
				"add_to_dossier",
				"assign_asn",
				"approve_review",
				"close_dossier",
				"create_dossier",
				"create_party",
				"create_share_link",
				"create_tag",
				"create_upload_link",
				"export_documents",
				"find_by_asn",
				"find_party_by_identifier",
				"apply_document_type",
				"create_document_type_from_document",
				"get_document",
				"get_document_text",
				"get_document_type",
				"get_party",
				"get_stats",
				"ignore_duplicate",
				"link_party",
				"list_categories",
				"list_custom_fields",
				"list_document_types",
				"list_dossiers",
				"list_duplicate_parties",
				"merge_parties",
				"list_intake_sources",
				"list_parties",
				"list_missing_periods",
				"list_reminders",
				"list_review_queue",
				"list_rules",
				"list_saved_searches",
				"list_share_links",
				"list_tags",
				"regenerate_titles",
				"reject_assignment",
				"remove_from_dossier",
				"reprocess_document",
				"revoke_share_link",
				"run_intake_source",
				"run_rule",
				"search_documents",
				"set_document_category",
				"set_document_tags",
				"set_field_value",
				"test_rule",
				"trash_document",
				"unlink_party",
				"update_document",
				"update_party",
				"upload_document",
			].sort(),
		);

		// Structured outputs: every tool announces its output schema.
		expect(tools.every((tool) => Boolean(tool.outputSchema))).toBe(true);
	});
});

describe("search_documents", () => {
	test("finds a document through full-text search", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "search_documents",
			arguments: { query: "électricité" },
		});

		const output = structured<{
			total: number;
			items: { id: string; title: string; parties: { name: string }[] }[];
		}>(result);
		expect(output.total).toBe(1);
		expect(output.items[0]?.id).toBe(seeded.id);
		expect(output.items[0]?.parties[0]?.name).toBe("EDF");
		expect(textOf(result)).toContain("Facture électricité");
	});

	test("filters by category and by tag", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const byCategory = await client.callTool({
			name: "search_documents",
			arguments: { categoryId: seeded.categoryId, tagIds: [seeded.tagId] },
		});
		expect(structured<{ total: number }>(byCategory).total).toBe(1);

		const other = await client.callTool({
			name: "search_documents",
			arguments: { query: "hypothèque" },
		});
		expect(structured<{ total: number }>(other).total).toBe(0);
		expect(textOf(other)).toContain("No document");
	});
});

describe("get_document / get_document_text", () => {
	test("the detail does not carry the OCR text", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "get_document",
			arguments: { id: seeded.id },
		});
		const output = structured<Record<string, unknown>>(result);
		expect(output.id).toBe(seeded.id);
		expect(output.hasText).toBe(true);
		expect(output).not.toHaveProperty("content");
	});

	test("returns the text of an ordinary document", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "get_document_text",
			arguments: { id: seeded.id },
		});
		const output = structured<{ text: string; masked: boolean }>(result);
		expect(output.masked).toBe(false);
		expect(output.text).toContain("84,20 EUR");
	});

	test("masks the text of a sensitive document without the `sensitive` scope", async () => {
		const seeded = await seedDocument({
			sensitive: true,
			content: "Bilan sanguin confidentiel",
		});
		const client = await connect(["read", "write"]);

		const result = await client.callTool({
			name: "get_document_text",
			arguments: { id: seeded.id },
		});
		const output = structured<{ text: string; masked: boolean }>(result);
		expect(output.masked).toBe(true);
		expect(output.text).toBe(SENSITIVE_PLACEHOLDER);
		expect(output.text).not.toContain("sanguin");
	});

	test("delivers the sensitive text with the `sensitive` scope", async () => {
		const seeded = await seedDocument({
			sensitive: true,
			content: "Bilan sanguin confidentiel",
		});
		const client = await connect(["read", "sensitive"]);

		const result = await client.callTool({
			name: "get_document_text",
			arguments: { id: seeded.id },
		});
		const output = structured<{ text: string; masked: boolean }>(result);
		expect(output.masked).toBe(false);
		expect(output.text).toContain("Bilan sanguin");
	});

	test("truncates the text at `maxChars`", async () => {
		const seeded = await seedDocument({ content: "x".repeat(500) });
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "get_document_text",
			arguments: { id: seeded.id, maxChars: 100 },
		});
		const output = structured<{ text: string; truncated: boolean }>(result);
		expect(output.text).toHaveLength(100);
		expect(output.truncated).toBe(true);
	});
});

describe("`write` scope", () => {
	test("update_document is refused without the `write` scope", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "sensitive"]);

		const result = await client.callTool({
			name: "update_document",
			arguments: { id: seeded.id, patch: { title: "Interdit" } },
		});

		expect(isToolError(result)).toBe(true);
		expect(textOf(result)).toContain("write");

		const rows = await db
			.select({ title: document.title })
			.from(document)
			.where(eq(document.id, seeded.id));
		expect(rows[0]?.title).toBe("Facture électricité");
	});

	test("update_document writes with the `write` scope", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "write"]);

		const result = await client.callTool({
			name: "update_document",
			arguments: {
				id: seeded.id,
				patch: { title: "Facture EDF janvier", sensitive: true },
			},
		});

		expect(isToolError(result)).toBe(false);
		const output = structured<{ title: string; sensitive: boolean }>(result);
		expect(output.title).toBe("Facture EDF janvier");
		expect(output.sensitive).toBe(true);
	});

	test("create_tag and set_document_tags honour the scope", async () => {
		const seeded = await seedDocument();
		const readOnly = await connect(["read"]);
		const refused = await readOnly.callTool({
			name: "create_tag",
			arguments: { name: "impots" },
		});
		expect(isToolError(refused)).toBe(true);

		const writer = await connect(["read", "write"]);
		const created = await writer.callTool({
			name: "create_tag",
			arguments: { name: "impots" },
		});
		const tagId = structured<{ id: string }>(created).id;

		const applied = await writer.callTool({
			name: "set_document_tags",
			arguments: { id: seeded.id, tagIds: [tagId] },
		});
		const output = structured<{ tags: { id: string }[] }>(applied);
		expect(output.tags.map((row) => row.id)).toEqual([tagId]);
	});
});

describe("Party and taxonomy", () => {
	test("find_party_by_identifier matches an issuer", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "find_party_by_identifier",
			arguments: { kind: "siren", value: "552081317" },
		});
		const output = structured<{ items: { id: string }[] }>(result);
		expect(output.items[0]?.id).toBe(seeded.partyId);
	});

	test("create_party then link_party attach a recipient", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "write"]);

		const created = await client.callTool({
			name: "create_party",
			arguments: {
				name: "Camille Moreau",
				type: "person",
				isHouseholdMember: true,
			},
		});
		const partyId = structured<{ id: string }>(created).id;

		const linked = await client.callTool({
			name: "link_party",
			arguments: { documentId: seeded.id, partyId, role: "recipient" },
		});
		const output = structured<{ parties: { id: string; role: string }[] }>(
			linked,
		);
		expect(
			output.parties.some(
				(row) => row.id === partyId && row.role === "recipient",
			),
		).toBe(true);
	});

	test("create_party refuses a household member that is not a person", async () => {
		const client = await connect(["read", "write"]);

		const refused = await client.callTool({
			name: "create_party",
			arguments: { name: "ACME", type: "company", isHouseholdMember: true },
		});
		expect(isToolError(refused)).toBe(true);
	});

	test("list_categories flattens the tree with the full path", async () => {
		await seedDocument();
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "list_categories",
			arguments: {},
		});
		const output = structured<{ items: { path: string }[] }>(result);
		expect(output.items.map((item) => item.path)).toContain("Factures");
	});

	test("get_stats aggregates the counters", async () => {
		await seedDocument();
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "get_stats",
			arguments: {},
		});
		const output = structured<{ total: number; reviewQueue: number }>(result);
		expect(output.total).toBe(1);
		expect(output.reviewQueue).toBe(0);
	});
});

describe("upload_document", () => {
	test("ingests a base64-encoded PDF", async () => {
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});

		const base64 = Buffer.from(
			await Bun.file(TEXT_LAYER_PDF).arrayBuffer(),
		).toString("base64");

		const result = await client.callTool({
			name: "upload_document",
			arguments: {
				filename: "facture.pdf",
				mime: "application/pdf",
				base64,
				title: "Facture téléversée",
			},
		});

		expect(isToolError(result)).toBe(false);
		const output = structured<{
			documentId: string | null;
			duplicateOf: string | null;
		}>(result);
		expect(output.duplicateOf).toBeNull();
		expect(output.documentId).toBeTruthy();

		const rows = await db
			.select({ title: document.title })
			.from(document)
			.where(eq(document.id, output.documentId as string));
		expect(rows[0]?.title).toBe("Facture téléversée");

		// A second upload of the same content is reported as a duplicate.
		const again = await client.callTool({
			name: "upload_document",
			arguments: {
				filename: "facture.pdf",
				mime: "application/pdf",
				base64,
			},
		});
		expect(
			structured<{ duplicateOf: string | null; trashed: boolean }>(again),
		).toMatchObject({ duplicateOf: output.documentId, trashed: false });
	});

	test("reports a duplicate held by a trashed document as `trashed`", async () => {
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});

		const base64 = Buffer.from(
			await Bun.file(TEXT_LAYER_PDF).arrayBuffer(),
		).toString("base64");
		const args = {
			filename: "facture.pdf",
			mime: "application/pdf",
			base64,
		};

		const first = structured<{ documentId: string | null }>(
			await client.callTool({ name: "upload_document", arguments: args }),
		);
		const documentId = first.documentId as string;
		await db
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, documentId));

		// The unique sha256 index ignores `deleted_at`, so the insert fails: the
		// tool must still answer with a duplicate rather than a tool error.
		const again = await client.callTool({
			name: "upload_document",
			arguments: args,
		});
		expect(isToolError(again)).toBe(false);
		expect(
			structured<{ duplicateOf: string | null; trashed: boolean }>(again),
		).toMatchObject({ duplicateOf: documentId, trashed: true });
	});

	test("expands a base64 ZIP archive", async () => {
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});

		const pdf = new Uint8Array(await Bun.file(TEXT_LAYER_PDF).arrayBuffer());
		const zip = zipSync({
			"invoice.pdf": pdf,
			"notes.txt": new TextEncoder().encode("nothing to see"),
		});

		const result = await client.callTool({
			name: "upload_document",
			arguments: {
				filename: "batch.zip",
				mime: "application/zip",
				base64: Buffer.from(zip).toString("base64"),
				archives: "both",
			},
		});

		expect(isToolError(result)).toBe(false);
		const output = structured<{
			documentId: string | null;
			archive: {
				mode: string;
				extracted: { entry: string; documentId: string }[];
				skipped: { entry: string }[];
				archiveDocumentId: string | null;
			} | null;
		}>(result);
		// An archive never produces a document "of its own" at the top level:
		// what it produced is spelled out entry by entry.
		expect(output.documentId).toBeNull();
		expect(output.archive?.mode).toBe("both");
		expect(output.archive?.extracted.map((entry) => entry.entry)).toEqual([
			"invoice.pdf",
		]);
		expect(output.archive?.skipped.map((entry) => entry.entry)).toEqual([
			"notes.txt",
		]);
		expect(output.archive?.archiveDocumentId).toBeTruthy();
	});

	test("refuses the upload without the `write` scope", async () => {
		const client = await connect(["read"], {
			ingestion: { ctx: ingestion.ctx },
		});
		const result = await client.callTool({
			name: "upload_document",
			arguments: { filename: "a.pdf", mime: "application/pdf", base64: "AAAA" },
		});
		expect(isToolError(result)).toBe(true);
	});

	test("refuses an unsupported file type", async () => {
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});
		const result = await client.callTool({
			name: "upload_document",
			arguments: {
				filename: "script.exe",
				mime: "application/x-msdownload",
				base64: "AAAA",
			},
		});
		expect(isToolError(result)).toBe(true);
	});
});

describe("document types, dossiers, reminders and relations", () => {
	/** Two fully elapsed months: the timeline does not depend on the day. */
	const currentMonth = periodStartOf("monthly", todayIso());
	const lastMonth = addMonths(currentMonth, -1);
	const twoMonthsAgo = addMonths(currentMonth, -2);

	/** Monthly recurring type covering the two previous months, no grace. */
	async function seedDocumentType(seeded: SeededDocument): Promise<string> {
		const id = createId("dty_");
		await db.insert(documentType).values({
			id,
			name: "Facture EDF",
			issuerPartyId: seeded.partyId,
			categoryId: seeded.categoryId,
			periodicity: "monthly",
			startPeriod: twoMonthsAgo,
			endPeriod: lastMonth,
			graceDays: 0,
		});
		// A type always owns at least one layout, home of its extraction rules.
		const layoutId = createId("dtl_");
		await db.insert(documentTypeLayout).values({
			id: layoutId,
			documentTypeId: id,
			name: "Default",
			isDefault: true,
		});
		await db.insert(extractionRule).values({
			name: "Total amount",
			layoutId,
			target: { kind: "title" },
			strategy: { kind: "regex", pattern: "Total : (\\d+)", group: 1 },
			postprocess: [],
		});
		return id;
	}

	test("list_document_types and list_missing_periods report the gap", async () => {
		const seeded = await seedDocument();
		// The document covers the month before last; the last one is still missing.
		await db
			.update(document)
			.set({ periodStart: twoMonthsAgo })
			.where(eq(document.id, seeded.id));
		const documentTypeId = await seedDocumentType(seeded);

		const client = await connect(["read"]);
		const listed = await client.callTool({
			name: "list_document_types",
			arguments: { recurringOnly: true },
		});
		const first = structured<{
			items: {
				id: string;
				present: number;
				expected: number;
				missing: string[];
			}[];
		}>(listed).items[0];
		expect(first?.id).toBe(documentTypeId);
		expect(first?.present).toBe(1);
		expect(first?.expected).toBe(2);
		expect(first?.missing).toEqual([lastMonth.slice(0, 7)]);

		const gaps = await client.callTool({
			name: "list_missing_periods",
			arguments: { documentTypeId },
		});
		const output = structured<{
			items: { documentTypeName: string; periods: { period: string }[] }[];
		}>(gaps);
		expect(output.items[0]?.documentTypeName).toBe("Facture EDF");
		expect(output.items[0]?.periods.map((entry) => entry.period)).toEqual([
			lastMonth.slice(0, 7),
		]);
	});

	test("get_document_type returns the layouts, their rules and the timeline", async () => {
		const seeded = await seedDocument();
		const documentTypeId = await seedDocumentType(seeded);

		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "get_document_type",
			arguments: { documentTypeId },
		});
		const output = structured<{
			type: { id: string; name: string; periodicity: string | null };
			layouts: {
				name: string;
				isDefault: boolean;
				extractionRules: {
					id: string;
					name: string;
					target: string;
					fieldId: string | null;
				}[];
			}[];
			timeline: { period: string }[];
		}>(result);
		expect(output.type.id).toBe(documentTypeId);
		expect(output.type.periodicity).toBe("monthly");
		expect(output.layouts).toHaveLength(1);
		expect(output.layouts[0]).toMatchObject({
			name: "Default",
			isDefault: true,
		});
		expect(output.layouts[0]?.extractionRules).toMatchObject([
			{ name: "Total amount", target: "title", fieldId: null },
		]);
		expect(output.timeline).toHaveLength(2);
	});

	test("apply_document_type requires `write` and links the issuer", async () => {
		const seeded = await seedDocument();
		const documentTypeId = await seedDocumentType(seeded);
		const other = await seedDocument({ title: "Autre facture" });

		const readOnly = await connect(["read"]);
		const refused = await readOnly.callTool({
			name: "apply_document_type",
			arguments: { documentTypeId, documentIds: [other.id] },
		});
		expect(isToolError(refused)).toBe(true);

		const writer = await connect(["read", "write"]);
		const applied = await writer.callTool({
			name: "apply_document_type",
			arguments: { documentTypeId, documentIds: [other.id] },
		});
		expect(structured<{ applied: number }>(applied).applied).toBe(1);

		const detail = await writer.callTool({
			name: "get_document",
			arguments: { id: other.id },
		});
		const output = structured<{
			documentType: { id: string; name: string } | null;
		}>(detail);
		expect(output.documentType?.id).toBe(documentTypeId);
		expect(textOf(detail)).toContain("document type: Facture EDF");
	});

	test("create_document_type_from_document prefills from the document", async () => {
		const seeded = await seedDocument();

		const client = await connect(["read", "write"]);
		const created = await client.callTool({
			name: "create_document_type_from_document",
			arguments: { documentId: seeded.id, name: "Factures EDF" },
		});
		const output = structured<{
			id: string;
			name: string;
			periodicity: string | null;
			documentCount: number;
		}>(created);
		expect(output.name).toBe("Factures EDF");
		expect(output.periodicity).toBeNull();
		expect(output.documentCount).toBe(1);
	});

	test("add_to_dossier requires `write` then updates list_dossiers", async () => {
		const seeded = await seedDocument();
		const dossierId = createId("dos_");
		await db.insert(dossier).values({ id: dossierId, name: "Achat maison" });

		const readOnly = await connect(["read"]);
		const refused = await readOnly.callTool({
			name: "add_to_dossier",
			arguments: { dossierId, documentIds: [seeded.id] },
		});
		expect(isToolError(refused)).toBe(true);
		expect(textOf(refused)).toContain("write");

		const writer = await connect(["read", "write"]);
		const added = await writer.callTool({
			name: "add_to_dossier",
			arguments: { dossierId, documentIds: [seeded.id] },
		});
		expect(structured<{ documentCount: number }>(added).documentCount).toBe(1);

		const listed = await writer.callTool({
			name: "list_dossiers",
			arguments: {},
		});
		const items = structured<{
			items: { id: string; documentCount: number }[];
		}>(listed).items;
		expect(items).toHaveLength(1);
		expect(items[0]?.documentCount).toBe(1);
	});

	test("add_document_relation links two documents and refuses the duplicate", async () => {
		const first = await seedDocument({ title: "Contrat" });
		const second = await seedDocument({ title: "Facture" });
		const client = await connect(["read", "write"]);

		const created = await client.callTool({
			name: "add_document_relation",
			arguments: {
				fromDocumentId: second.id,
				toDocumentId: first.id,
				kind: "fulfills",
			},
		});
		expect(isToolError(created)).toBe(false);
		expect(structured<{ id: string }>(created).id).toStartWith("drl_");

		const again = await client.callTool({
			name: "add_document_relation",
			arguments: {
				fromDocumentId: second.id,
				toDocumentId: first.id,
				kind: "fulfills",
			},
		});
		expect(isToolError(again)).toBe(true);

		// The relation shows up in the detail exposed to the agent.
		const detail = await client.callTool({
			name: "get_document",
			arguments: { id: first.id },
		});
		const relations = structured<{
			relations: { kind: string; direction: string; documentId: string }[];
		}>(detail).relations;
		expect(relations).toHaveLength(1);
		expect(relations[0]).toMatchObject({
			kind: "fulfills",
			direction: "incoming",
			documentId: second.id,
		});
	});

	test("list_reminders and list_saved_searches return what exists", async () => {
		const seeded = await seedDocument();
		await db
			.update(document)
			.set({ validUntil: "2027-06-30" })
			.where(eq(document.id, seeded.id));
		await generateReminders(db);

		await db.insert(savedSearch).values({
			id: createId("sav_"),
			name: "Factures EDF",
			filters: { deleted: "exclude", pageSize: 25, sort: "documentDate:desc" },
			sortOrder: 0,
		});

		const client = await connect(["read"]);
		const reminders = structured<{
			items: { kind: string; dueDate: string; documentTitle: string | null }[];
		}>(await client.callTool({ name: "list_reminders", arguments: {} })).items;
		expect(reminders).toHaveLength(3);
		expect(reminders.every((item) => item.kind === "expiry")).toBe(true);
		expect(reminders[0]?.dueDate).toBe("2027-04-01");

		const searches = structured<{ items: { name: string }[] }>(
			await client.callTool({ name: "list_saved_searches", arguments: {} }),
		).items;
		expect(searches.map((item) => item.name)).toEqual(["Factures EDF"]);
	});
});

describe("resources", () => {
	test("lists the recent documents and reads one record", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const listed = await client.listResources();
		expect(listed.resources.map((resource) => resource.uri)).toContain(
			`docstore://document/${seeded.id}`,
		);

		const read = await client.readResource({
			uri: `docstore://document/${seeded.id}`,
		});
		const payload = JSON.parse(resourceText(read)) as {
			id: string;
			title: string;
		};
		expect(payload.id).toBe(seeded.id);
		expect(payload.title).toBe("Facture électricité");
	});

	test("reads a Party by its URI", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const read = await client.readResource({
			uri: `docstore://party/${seeded.partyId}`,
		});
		const payload = JSON.parse(resourceText(read)) as {
			name: string;
			documentCount: number;
		};
		expect(payload.name).toBe("EDF");
		expect(payload.documentCount).toBe(1);
	});
});

describe("prompts", () => {
	test("exposes the two operating modes", async () => {
		const client = await connect(["read"]);
		const { prompts } = await client.listPrompts();
		expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
			"classify_document",
			"review_queue",
		]);
	});

	test("classify_document injects the document identifier", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);

		const prompt = await client.getPrompt({
			name: "classify_document",
			arguments: { documentId: seeded.id },
		});
		const content = prompt.messages[0]?.content;
		const text = content && "text" in content ? String(content.text) : "";
		expect(text).toContain(seeded.id);
		expect(text).toContain("find_party_by_identifier");
	});

	test("review_queue describes the steps to follow", async () => {
		const client = await connect(["read"]);
		const prompt = await client.getPrompt({
			name: "review_queue",
			arguments: {},
		});
		const content = prompt.messages[0]?.content;
		const text = content && "text" in content ? String(content.text) : "";
		expect(text).toContain("list_review_queue");
	});
});

describe("intake tools", () => {
	test("list_intake_sources returns the counters without the password", async () => {
		process.env.APP_SECRET = "secret-de-test-suffisamment-long-0123456789";
		await db.insert(intakeSource).values({
			type: "mail",
			name: "Boîte factures",
			enabled: true,
			config: {
				type: "mail",
				host: "imap.example.test",
				port: 993,
				secure: true,
				username: "camille@example.test",
				passwordEncrypted: "chiffré",
				mailbox: "INBOX",
				pollSeconds: 300,
				onlyUnseen: true,
				afterImport: "mark_seen",
				attachmentsOnly: true,
				importBodyAsPdf: false,
			},
			defaults: {},
			stats: { imported: 4, duplicates: 1, errors: 0 },
		});

		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "list_intake_sources",
			arguments: {},
		});

		const output = structured<{
			sources: { name: string; type: string; imported: number }[];
		}>(result);
		expect(output.sources).toHaveLength(1);
		expect(output.sources[0]).toMatchObject({
			name: "Boîte factures",
			type: "mail",
			imported: 4,
		});
		expect(JSON.stringify(result)).not.toContain("chiffré");
	});

	test("run_intake_source requires the write scope", async () => {
		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "run_intake_source",
			arguments: { id: "src_inconnu" },
		});
		expect(isToolError(result)).toBe(true);
		expect(textOf(result)).toContain("write");
	});

	test("create_upload_link returns a public URL", async () => {
		const client = await connect(["read", "write"]);
		const result = await client.callTool({
			name: "create_upload_link",
			arguments: { name: "Dépôt du comptable", maxUses: 2 },
		});

		const output = structured<{ id: string; url: string; maxUses: number }>(
			result,
		);
		expect(output.id).toStartWith("ulk_");
		expect(output.url).toContain("/u/");
		expect(output.maxUses).toBe(2);
	});

	test("create_upload_link refuses a key without write", async () => {
		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "create_upload_link",
			arguments: { name: "Dépôt" },
		});
		expect(isToolError(result)).toBe(true);
	});
});

describe("sharing tools", () => {
	test("create_share_link, list_share_links and revoke_share_link", async () => {
		const seeded = await seedDocument({ title: "Facture eau" });
		const client = await connect(["read", "write"]);

		const created = await client.callTool({
			name: "create_share_link",
			arguments: { documentId: seeded.id, maxViews: 5 },
		});
		const link = structured<{ id: string; url: string; kind: string }>(created);
		expect(link.id).toStartWith("shl_");
		expect(link.url).toContain("/s/");
		expect(link.kind).toBe("document");

		const listed = await client.callTool({
			name: "list_share_links",
			arguments: { documentId: seeded.id },
		});
		expect(structured<{ links: unknown[] }>(listed).links).toHaveLength(1);

		const revoked = await client.callTool({
			name: "revoke_share_link",
			arguments: { id: link.id },
		});
		expect(
			structured<{ revokedAt: string | null }>(revoked).revokedAt,
		).not.toBeNull();
	});

	test("create_share_link refuses a sensitive document and a key without write", async () => {
		const seeded = await seedDocument({ sensitive: true });

		const writer = await connect(["read", "write"]);
		const refused = await writer.callTool({
			name: "create_share_link",
			arguments: { documentId: seeded.id },
		});
		expect(isToolError(refused)).toBe(true);
		expect(textOf(refused)).toContain("sensitive");

		const reader = await connect(["read"]);
		const denied = await reader.callTool({
			name: "create_share_link",
			arguments: { documentId: seeded.id },
		});
		expect(isToolError(denied)).toBe(true);
	});

	test("export_documents previews without returning the archive", async () => {
		await seedDocument({ title: "Facture eau" });
		const client = await connect(["read"]);

		const result = await client.callTool({
			name: "export_documents",
			arguments: { layout: "by-year" },
		});
		const output = structured<{
			count: number;
			sample: string[];
			downloadWith: string;
		}>(result);
		// The document has no file: the count stays at zero, the route is named.
		expect(output.count).toBe(0);
		expect(output.downloadWith).toBe("POST /api/export");
	});

	test("assign_asn then find_by_asn", async () => {
		const seeded = await seedDocument({ title: "Acte notarié" });
		const client = await connect(["read", "write"]);

		const next = await client.callTool({ name: "find_by_asn", arguments: {} });
		expect(structured<{ nextAsn: number }>(next).nextAsn).toBe(1);

		const assigned = await client.callTool({
			name: "assign_asn",
			arguments: { id: seeded.id },
		});
		expect(structured<{ asn: number }>(assigned).asn).toBe(1);

		const found = await client.callTool({
			name: "find_by_asn",
			arguments: { asn: 1 },
		});
		expect(structured<{ document: { id: string } }>(found).document.id).toBe(
			seeded.id,
		);
	});

	test("assign_asn refuses a key without write", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read"]);
		const result = await client.callTool({
			name: "assign_asn",
			arguments: { id: seeded.id },
		});
		expect(isToolError(result)).toBe(true);
	});
});

describe("MCP — content validation on upload", () => {
	test("refuses content that is not one of the accepted formats", async () => {
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});

		const result = await client.callTool({
			name: "upload_document",
			arguments: {
				filename: "facture.pdf",
				mime: "application/pdf",
				// Valid base64, but the bytes are not a PDF.
				base64: Buffer.from("this is not a PDF").toString("base64"),
			},
		});
		expect(isToolError(result)).toBe(true);
		expect(textOf(result)).toContain("Accepted formats");
		expect(await db.select().from(document)).toHaveLength(0);
	});

	test("refuses a payload that is not valid base64", async () => {
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});

		for (const base64 of ["not base64!!", "QUJD@", "QUJDR"]) {
			const result = await client.callTool({
				name: "upload_document",
				arguments: { filename: "a.pdf", mime: "application/pdf", base64 },
			});
			expect(isToolError(result)).toBe(true);
			expect(textOf(result)).toContain("base64");
		}
	});
});

describe("MCP — the trash is read-only", () => {
	async function trashed(): Promise<SeededDocument> {
		const seeded = await seedDocument();
		await db
			.update(document)
			.set({ deletedAt: new Date() })
			.where(eq(document.id, seeded.id));
		return seeded;
	}

	test("update_document, set_document_category and link_party are refused", async () => {
		const client = await connect(["read", "write"]);
		const seeded = await trashed();

		for (const call of [
			{
				name: "update_document",
				arguments: { id: seeded.id, patch: { title: "Renamed" } },
			},
			{
				name: "set_document_category",
				arguments: { id: seeded.id, categoryId: seeded.categoryId },
			},
			{
				name: "set_document_tags",
				arguments: { id: seeded.id, tagIds: [] },
			},
			{
				name: "link_party",
				arguments: {
					documentId: seeded.id,
					partyId: seeded.partyId,
					role: "recipient",
				},
			},
		]) {
			const result = await client.callTool(call);
			expect(isToolError(result)).toBe(true);
			expect(textOf(result)).toContain("trash");
		}
	});

	test("add_to_dossier and add_document_relation are refused", async () => {
		const client = await connect(["read", "write"]);
		const seeded = await trashed();
		const live = await seedDocument({ title: "Live" });

		const dossierId = createId("dos_");
		await db.insert(dossier).values({ id: dossierId, name: "Case" });

		expect(
			isToolError(
				await client.callTool({
					name: "add_to_dossier",
					arguments: { dossierId, documentIds: [seeded.id] },
				}),
			),
		).toBe(true);

		expect(
			isToolError(
				await client.callTool({
					name: "add_document_relation",
					arguments: {
						fromDocumentId: seeded.id,
						toDocumentId: live.id,
						kind: "related_to",
					},
				}),
			),
		).toBe(true);
	});
});

describe("MCP — manual assignments and disabled entities", () => {
	test("reject_assignment refuses a manual category", async () => {
		const client = await connect(["read", "write"]);
		const seeded = await seedDocument();
		// `seedDocument` leaves every assignment on its default `manual` source.
		const result = await client.callTool({
			name: "reject_assignment",
			arguments: { id: seeded.id, kind: "category" },
		});
		expect(isToolError(result)).toBe(true);
		expect(textOf(result)).toContain("set manually");
	});

	test("list_document_types hides the disabled ones by default", async () => {
		const client = await connect(["read"]);
		await db.insert(documentType).values([
			{ id: createId("dty_"), name: "Live" },
			{ id: createId("dty_"), name: "Retired", enabled: false },
		]);

		const listed = structured<{ items: { name: string }[] }>(
			await client.callTool({ name: "list_document_types", arguments: {} }),
		);
		expect(listed.items.map((item) => item.name)).toEqual(["Live"]);

		const all = structured<{ items: { name: string }[] }>(
			await client.callTool({
				name: "list_document_types",
				arguments: { includeDisabled: true },
			}),
		);
		expect(all.items.map((item) => item.name).sort()).toEqual([
			"Live",
			"Retired",
		]);
	});

	test("apply_document_type refuses a disabled type unless forced", async () => {
		const client = await connect(["read", "write"]);
		const seeded = await seedDocument();
		const typeId = createId("dty_");
		await db
			.insert(documentType)
			.values({ id: typeId, name: "Retired", enabled: false });
		await db.insert(documentTypeLayout).values({
			documentTypeId: typeId,
			name: "Default",
			isDefault: true,
		});

		const refused = await client.callTool({
			name: "apply_document_type",
			arguments: { documentTypeId: typeId, documentIds: [seeded.id] },
		});
		expect(isToolError(refused)).toBe(true);
		expect(textOf(refused)).toContain("disabled");

		const forced = structured<{ applied: number }>(
			await client.callTool({
				name: "apply_document_type",
				arguments: {
					documentTypeId: typeId,
					documentIds: [seeded.id],
					force: true,
				},
			}),
		);
		expect(forced.applied).toBe(1);
	});

	test("test_rule reports an automation without action", async () => {
		const client = await connect(["read"]);
		const seeded = await seedDocument();
		const ruleId = createId("rul_");
		await db.insert(rule).values({
			id: ruleId,
			name: "Leftover",
			condition: { op: "and", children: [] },
			actions: [],
		});

		const result = structured<{ hasActions: boolean; matched: boolean }>(
			await client.callTool({
				name: "test_rule",
				arguments: { ruleId, documentId: seeded.id },
			}),
		);
		expect(result.matched).toBe(true);
		expect(result.hasActions).toBe(false);
	});
});

describe("MCP — custom field constraints", () => {
	test("set_field_value refuses a foreign currency", async () => {
		const client = await connect(["read", "write"]);
		const seeded = await seedDocument();
		const fieldId = createId("cf_");
		await db.insert(customField).values({
			id: fieldId,
			name: "Total amount",
			slug: `total-${fieldId}`,
			type: "money",
			options: { currency: "EUR" },
		});

		const result = await client.callTool({
			name: "set_field_value",
			arguments: {
				documentId: seeded.id,
				fieldId,
				value: { kind: "money", amount: 10, currency: "USD" },
			},
		});
		expect(isToolError(result)).toBe(true);
		expect(textOf(result)).toContain("EUR");
	});
});

/**
 * Enum values of the tool schemas come from `@docstore/shared`, never from a
 * list retyped by hand: a status added to `DOCUMENT_STATUSES` or a layout added
 * to `EXPORT_LAYOUTS` has to show up here without anyone editing the MCP
 * package. These assertions are what turns "we copied it right" into "it cannot
 * drift".
 */
describe("tool schemas — no drift from the shared enums", () => {
	/** `enum` of one property of a tool input schema, wherever zod put it. */
	function enumOf(schema: unknown, property: string): string[] | undefined {
		const properties = (schema as { properties?: Record<string, unknown> })
			.properties;
		const found = properties?.[property] as
			| { enum?: string[]; anyOf?: { enum?: string[] }[] }
			| undefined;
		if (!found) return undefined;
		return found.enum ?? found.anyOf?.find((item) => item.enum)?.enum;
	}

	test("the enums match their single source of truth", async () => {
		const client = await connect(["read"]);
		const { tools } = await client.listTools();
		const byName = new Map(tools.map((tool) => [tool.name, tool]));

		const search = byName.get("search_documents");
		expect(enumOf(search?.inputSchema, "status")?.sort()).toEqual(
			[...DOCUMENT_STATUSES].sort(),
		);
		// The status the pipeline lands on when it gives up is searchable.
		expect(enumOf(search?.inputSchema, "status")).toContain("failed");

		expect(
			enumOf(byName.get("export_documents")?.inputSchema, "layout")?.sort(),
		).toEqual([...EXPORT_LAYOUTS].sort());
		expect(
			enumOf(byName.get("link_party")?.inputSchema, "role")?.sort(),
		).toEqual([...DOCUMENT_PARTY_ROLES].sort());
		expect(
			enumOf(byName.get("create_party")?.inputSchema, "type")?.sort(),
		).toEqual([...PARTY_TYPES].sort());
		expect(
			enumOf(
				byName.get("find_party_by_identifier")?.inputSchema,
				"kind",
			)?.sort(),
		).toEqual([...PARTY_IDENTIFIER_KINDS].sort());
		expect(
			enumOf(byName.get("add_document_relation")?.inputSchema, "kind")?.sort(),
		).toEqual([...DOCUMENT_RELATION_KINDS].sort());
	});

	test("the manual overrides are reachable", async () => {
		const client = await connect(["read"]);
		const { tools } = await client.listTools();
		const byName = new Map(tools.map((tool) => [tool.name, tool]));

		for (const name of ["run_rule", "apply_document_type"]) {
			const schema = byName.get(name)?.inputSchema as
				| { properties?: Record<string, { type?: string }> }
				| undefined;
			// Without `force` a disabled rule or type cannot be applied on demand.
			const force = schema?.properties?.force;
			expect(force).toBeDefined();
			// `mcpBoolean` widens what the server accepts, never what it announces.
			expect(force?.type).toBe("boolean");
		}
	});
});

describe("expiry guards over MCP", () => {
	test("create_share_link refuses an expiry in the past", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "write"]);

		const refused = await client.callTool({
			name: "create_share_link",
			arguments: {
				documentId: seeded.id,
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			},
		});
		expect(isToolError(refused)).toBe(true);

		const created = await client.callTool({
			name: "create_share_link",
			arguments: {
				documentId: seeded.id,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			},
		});
		expect(isToolError(created)).toBe(false);
	});

	test("create_upload_link refuses an expiry in the past", async () => {
		const client = await connect(["read", "write"]);
		const refused = await client.callTool({
			name: "create_upload_link",
			arguments: {
				name: "Send me the deed",
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			},
		});
		expect(isToolError(refused)).toBe(true);
	});
});

describe("party maintenance tools", () => {
	test("update_party merges the identifiers, `replaceIdentifiers` does not", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "write"]);

		const merged = await client.callTool({
			name: "update_party",
			arguments: {
				id: seeded.partyId,
				identifiers: { domain: ["https://www.edf.fr/particuliers"] },
			},
		});
		const afterMerge = structured<{
			identifiers: Record<string, unknown>;
		}>(merged).identifiers;
		// The SIREN seeded next to it survives, and the URL is reduced to its host.
		expect(afterMerge).toEqual({
			siren: "552081317",
			domain: ["edf.fr"],
		});

		const replaced = await client.callTool({
			name: "update_party",
			arguments: {
				id: seeded.partyId,
				identifiers: { domain: ["edf.fr"] },
				replaceIdentifiers: true,
			},
		});
		expect(
			structured<{ identifiers: Record<string, unknown> }>(replaced)
				.identifiers,
		).toEqual({ domain: ["edf.fr"] });
	});

	test("list_duplicate_parties then merge_parties absorbs the double", async () => {
		const seeded = await seedDocument();
		const writer = await connect(["read", "write"]);

		const duplicateId = createId("prt_");
		await db.insert(party).values({
			id: duplicateId,
			type: "company",
			name: " edf ",
			identifiers: { vat: "FR03552081317" },
		});

		const listed = await writer.callTool({
			name: "list_duplicate_parties",
			arguments: {},
		});
		const pairs = structured<{
			items: { partyId: string; otherPartyId: string; reason: string }[];
		}>(listed).items;
		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.reason).toBe("sameName");

		const readOnly = await connect(["read"]);
		expect(
			isToolError(
				await readOnly.callTool({
					name: "merge_parties",
					arguments: { sourceId: duplicateId, targetId: seeded.partyId },
				}),
			),
		).toBe(true);

		const merged = await writer.callTool({
			name: "merge_parties",
			arguments: { sourceId: duplicateId, targetId: seeded.partyId },
		});
		const output = structured<{
			archivedId: string;
			target: { identifiers: Record<string, unknown>; aliases: string[] };
		}>(merged);
		expect(output.archivedId).toBe(duplicateId);
		expect(output.target.identifiers).toEqual({
			siren: "552081317",
			vat: "FR03552081317",
		});
		expect(output.target.aliases).toContain(" edf ");

		expect(
			structured<{ items: unknown[] }>(
				await writer.callTool({
					name: "list_duplicate_parties",
					arguments: {},
				}),
			).items,
		).toEqual([]);
	});
});

describe("dossier write tools", () => {
	test("create, fill, remove and close a Dossier from MCP", async () => {
		const first = await seedDocument({ title: "Deed" });
		const second = await seedDocument({ title: "Insurance" });
		const client = await connect(["read", "write"]);

		const created = structured<{ id: string; documentCount: number }>(
			await client.callTool({
				name: "create_dossier",
				arguments: { name: "Housing", description: "Flat purchase" },
			}),
		);
		expect(created.documentCount).toBe(0);

		const filled = structured<{ documentCount: number }>(
			await client.callTool({
				name: "add_to_dossier",
				arguments: {
					dossierId: created.id,
					documentIds: [first.id, second.id],
				},
			}),
		);
		expect(filled.documentCount).toBe(2);

		const trimmed = structured<{ documentCount: number }>(
			await client.callTool({
				name: "remove_from_dossier",
				arguments: { dossierId: created.id, documentId: second.id },
			}),
		);
		expect(trimmed.documentCount).toBe(1);

		const closed = structured<{ status: string }>(
			await client.callTool({
				name: "close_dossier",
				arguments: { dossierId: created.id },
			}),
		);
		expect(closed.status).toBe("closed");
		// A closed Dossier leaves the default listing but keeps its document.
		expect(
			structured<{ items: unknown[] }>(
				await client.callTool({ name: "list_dossiers", arguments: {} }),
			).items,
		).toEqual([]);

		const reopened = structured<{ status: string; documentCount: number }>(
			await client.callTool({
				name: "close_dossier",
				arguments: { dossierId: created.id, reopen: true },
			}),
		);
		expect(reopened.status).toBe("open");
		expect(reopened.documentCount).toBe(1);
	});

	test("the three writes need the `write` scope", async () => {
		const client = await connect(["read"]);
		for (const call of [
			{ name: "create_dossier", arguments: { name: "Read only" } },
			{
				name: "remove_from_dossier",
				arguments: { dossierId: "dos_x", documentId: "doc_x" },
			},
			{ name: "close_dossier", arguments: { dossierId: "dos_x" } },
		]) {
			const result = await client.callTool(call);
			expect(isToolError(result)).toBe(true);
			expect(textOf(result)).toContain("write");
		}
	});

	test("remove_from_dossier does not reopen the revoked links", async () => {
		const secret = await seedDocument({ sensitive: true });
		const client = await connect(["read", "write", "sensitive"]);

		const created = structured<{ id: string }>(
			await client.callTool({
				name: "create_dossier",
				arguments: { name: "Santé" },
			}),
		);
		await client.callTool({
			name: "create_share_link",
			arguments: { dossierId: created.id },
		});
		await client.callTool({
			name: "add_to_dossier",
			arguments: { dossierId: created.id, documentIds: [secret.id] },
		});
		await client.callTool({
			name: "remove_from_dossier",
			arguments: { dossierId: created.id, documentId: secret.id },
		});

		const links = await db
			.select({ revokedReason: shareLink.revokedReason })
			.from(shareLink);
		expect(links.map((row) => row.revokedReason)).toEqual(["sensitive"]);
	});
});

/**
 * A fair number of MCP clients build their arguments from a text template and
 * send every scalar as a string. `mcpBoolean` accepts both spellings without
 * changing the schema the client is handed.
 */
describe("boolean inputs sent as strings", () => {
	test('"true"/"false" are accepted wherever a boolean is', async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "write"]);
		await db.insert(documentType).values([
			{ id: createId("dty_"), name: "Live" },
			{ id: createId("dty_"), name: "Retired", enabled: false },
		]);

		const listed = structured<{ items: { name: string }[] }>(
			await client.callTool({
				name: "list_document_types",
				arguments: { includeDisabled: "true" },
			}),
		);
		expect(listed.items.map((item) => item.name).sort()).toEqual([
			"Live",
			"Retired",
		]);

		// `false` as a string means false, not "any non-empty string".
		expect(
			structured<{ items: { name: string }[] }>(
				await client.callTool({
					name: "list_document_types",
					arguments: { includeDisabled: "false" },
				}),
			).items.map((item) => item.name),
		).toEqual(["Live"]);

		const patched = structured<{ sensitive: boolean }>(
			await client.callTool({
				name: "update_document",
				arguments: { id: seeded.id, patch: { sensitive: "true" } },
			}),
		);
		expect(patched.sensitive).toBe(true);

		const search = structured<{ total: number }>(
			await client.callTool({
				name: "search_documents",
				arguments: { sensitive: "true" },
			}),
		);
		expect(search.total).toBe(1);

		// Anything that is not a boolean spelling is still a validation error.
		const refused = await client.callTool({
			name: "search_documents",
			arguments: { sensitive: "yes" },
		});
		expect(isToolError(refused)).toBe(true);
	});

	test("the published schema still announces a plain boolean", async () => {
		const client = await connect(["read"]);
		const { tools } = await client.listTools();
		const byName = new Map(tools.map((tool) => [tool.name, tool]));
		const schema = byName.get("apply_document_type")?.inputSchema as
			| { properties?: Record<string, { type?: string }> }
			| undefined;
		expect(schema?.properties?.force?.type).toBe("boolean");
	});
});

describe("add_to_dossier and the sensitive flag", () => {
	test("filing a sensitive document revokes the dossier links", async () => {
		const secret = await seedDocument({ sensitive: true });
		const dossierId = createId("dos_");
		await db.insert(dossier).values({ id: dossierId, name: "Santé" });

		const client = await connect(["read", "write", "sensitive"]);
		const created = await client.callTool({
			name: "create_share_link",
			arguments: { dossierId },
		});
		expect(isToolError(created)).toBe(false);

		await client.callTool({
			name: "add_to_dossier",
			arguments: { dossierId, documentIds: [secret.id] },
		});

		const links = await db
			.select({ revokedReason: shareLink.revokedReason })
			.from(shareLink);
		expect(links.map((row) => row.revokedReason)).toEqual(["sensitive"]);
	});
});

describe("reprocess_document and the trash", () => {
	test("a trashed document is refused", async () => {
		const seeded = await seedDocument();
		const client = await connect(["read", "write"], {
			ingestion: { ctx: ingestion.ctx },
		});

		await client.callTool({
			name: "trash_document",
			arguments: { id: seeded.id },
		});
		const refused = await client.callTool({
			name: "reprocess_document",
			arguments: { id: seeded.id },
		});
		expect(isToolError(refused)).toBe(true);
		expect(textOf(refused)).toContain("trash");
	});
});
