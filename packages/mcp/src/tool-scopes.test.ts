import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	createTestClient,
	createTestUser,
	type TestUser,
} from "@docstore/api/test-utils";
import { intakeSource } from "@docstore/db/schema/intake";
import {
	createTestDb,
	type TestDb,
	truncateAll,
} from "@docstore/db/test-utils";
import type { IngestionBinding } from "@docstore/ingestion";
import type { ApiKeyScope } from "@docstore/shared/api-key";
import { createMcpTestClient, type McpTestHarness } from "./test-utils";

/**
 * Issue #24: every MCP tool requires the same scope as its oRPC procedure.
 *
 * The table pairs each tool with the procedure it mirrors. Both sides are
 * probed the same way: a key holding a single scope calls it, and the required
 * scope is the first of `read`, `write`, `admin` that is not refused for
 * lacking a scope. Nothing is declared by hand, so a tool that drifts from its
 * procedure (or a procedure that moves) fails here.
 */
const TOOL_PROCEDURES: Record<string, string> = {
	// Documents
	search_documents: "document.list",
	get_document: "document.get",
	get_document_text: "document.get",
	get_stats: "document.stats",
	update_document: "document.update",
	set_document_category: "document.setCategory",
	set_document_tags: "document.setTags",
	link_party: "document.addParty",
	unlink_party: "document.removeParty",
	set_field_value: "document.setFieldValue",
	trash_document: "document.trash",
	ignore_duplicate: "document.ignoreDuplicate",
	reprocess_document: "document.reprocess",
	add_document_relation: "document.addRelation",
	assign_asn: "document.assignAsn",
	find_by_asn: "document.byAsn",
	upload_document: "file.upload",
	// Review
	list_review_queue: "review.list",
	approve_review: "review.approve",
	reject_assignment: "review.rejectAssignment",
	// Parties
	list_parties: "party.list",
	get_party: "party.get",
	create_party: "party.create",
	update_party: "party.update",
	merge_parties: "party.mergeInto",
	list_duplicate_parties: "party.duplicates",
	find_party_by_identifier: "party.findByIdentifier",
	// Taxonomy and automations
	list_categories: "category.list",
	list_tags: "tag.list",
	create_tag: "tag.create",
	list_custom_fields: "customField.list",
	list_rules: "rule.list",
	test_rule: "rule.test",
	run_rule: "rule.run",
	// Document types
	list_document_types: "documentType.list",
	get_document_type: "documentType.get",
	list_missing_periods: "documentType.get",
	regenerate_titles: "documentType.regenerateTitles",
	apply_document_type: "documentType.apply",
	create_document_type_from_document: "documentType.createFromDocument",
	// Dossiers, reminders, saved searches
	list_dossiers: "dossier.list",
	create_dossier: "dossier.create",
	add_to_dossier: "dossier.addDocuments",
	remove_from_dossier: "dossier.removeDocument",
	close_dossier: "dossier.close",
	list_reminders: "reminder.list",
	list_saved_searches: "savedSearch.list",
	// Intake and upload links
	list_intake_sources: "intakeSource.list",
	run_intake_source: "intakeSource.runNow",
	create_upload_link: "uploadLink.create",
	// Sharing and export
	list_share_links: "shareLink.list",
	create_share_link: "shareLink.create",
	revoke_share_link: "shareLink.revoke",
	export_documents: "export.preview",
	// Activity
	list_activity: "activity.list",
};

const LEVELS = ["read", "write", "admin"] as const;
type Level = (typeof LEVELS)[number];

/** Message of `requireRead` / `requireWrite` / `requireAdmin` (context.ts). */
const MCP_SCOPE_ERROR = /does not have the `(read|write|admin)` scope/;
/** Message of `requireScope` (packages/api/src/index.ts). */
const ORPC_SCOPE_ERROR = /does not have the "(read|write|admin)" scope/;

let db: TestDb;
let owner: TestUser;
const harnesses: McpTestHarness[] = [];

beforeAll(async () => {
	db = await createTestDb();
	process.env.APP_SECRET = "test-secret-long-enough-01234567890123456";
});

afterAll(async () => {
	while (harnesses.length > 0) {
		await harnesses.pop()?.close();
	}
	await db.$client.end();
});

beforeEach(async () => {
	while (harnesses.length > 0) {
		await harnesses.pop()?.close();
	}
	await truncateAll(db);
	owner = await createTestUser(db);
});

async function connect(
	scopes: ApiKeyScope[],
	ingestion?: IngestionBinding,
): Promise<McpTestHarness["client"]> {
	const harness = await createMcpTestClient({
		db,
		userId: owner.id,
		scopes,
		ingestion,
	});
	harnesses.push(harness);
	return harness.client;
}

function isToolError(result: unknown): boolean {
	return (result as { isError?: boolean }).isError === true;
}

function textOf(result: unknown): string {
	const blocks =
		(result as { content?: { type: string; text?: string }[] }).content ?? [];
	return blocks.map((block) => block.text ?? "").join("\n");
}

interface JsonSchema {
	type?: string;
	enum?: unknown[];
	const?: unknown;
	minItems?: number;
	items?: JsonSchema;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
}

/**
 * Smallest value accepted by an input schema: the arguments must pass the
 * validation of the MCP SDK, which runs before the scope check of the tool.
 */
function sampleOf(schema: JsonSchema): unknown {
	if (schema.const !== undefined) return schema.const;
	if (schema.enum) return schema.enum[0];
	const variant = schema.anyOf?.[0] ?? schema.oneOf?.[0];
	if (variant) return sampleOf(variant);
	switch (schema.type) {
		case "string":
			return "x";
		case "number":
		case "integer":
			return 1;
		case "boolean":
			return false;
		case "array":
			return Array.from({ length: schema.minItems ?? 0 }, () =>
				sampleOf(schema.items ?? { type: "string" }),
			);
		default: {
			const value: Record<string, unknown> = {};
			for (const key of schema.required ?? []) {
				value[key] = sampleOf(schema.properties?.[key] ?? {});
			}
			return value;
		}
	}
}

/** Whether a key holding only `scopes` is refused by the tool's scope check. */
async function mcpRefuses(
	tool: string,
	args: unknown,
	scopes: ApiKeyScope[],
): Promise<boolean> {
	const client = await connect(scopes);
	const result = await client.callTool({
		name: tool,
		arguments: args as Record<string, unknown>,
	});
	return isToolError(result) && MCP_SCOPE_ERROR.test(textOf(result));
}

type ProcedureCall = (input: unknown) => Promise<unknown>;

/** Whether a key holding only `scopes` is refused by the procedure's scope. */
async function orpcRefuses(
	path: string,
	scopes: ApiKeyScope[],
): Promise<boolean> {
	const client = createTestClient(db, owner, { id: "key_probe", scopes });
	const [domain, name] = path.split(".");
	const router = (
		client as unknown as Record<string, Record<string, ProcedureCall>>
	)[domain ?? ""];
	const call = router?.[name ?? ""];
	if (typeof call !== "function") throw new Error(`No procedure ${path}`);
	// The scope middleware runs before the input validation: an empty input
	// is enough to tell a scope refusal from any other outcome.
	const error = await call({}).then(
		() => null,
		(caught: unknown) => caught,
	);
	const { code, message } = (error ?? {}) as {
		code?: string;
		message?: string;
	};
	return code === "FORBIDDEN" && ORPC_SCOPE_ERROR.test(message ?? "");
}

async function requiredLevel(
	refuses: (scopes: ApiKeyScope[]) => Promise<boolean>,
): Promise<Level | "none"> {
	for (const level of LEVELS) {
		if (!(await refuses([level]))) return level;
	}
	return "none";
}

describe("Docstore SHALL require on every MCP tool the scope of its oRPC procedure (issue #24)", () => {
	test("WHEN the tools are listed THEN each one is paired with a procedure", async () => {
		const client = await connect(["admin"]);
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			Object.keys(TOOL_PROCEDURES).sort(),
		);
	});

	test("WHEN a single-scope key calls each tool and its procedure THEN both require the same scope", async () => {
		const client = await connect(["admin"]);
		const { tools } = await client.listTools();

		const mismatches: string[] = [];
		for (const tool of tools) {
			const procedure = TOOL_PROCEDURES[tool.name];
			if (!procedure) continue;
			const args = sampleOf(tool.inputSchema as JsonSchema);

			// A key without any of the three scopes is refused on both sides:
			// the probe reaches the scope check (arguments and input accepted).
			expect(await mcpRefuses(tool.name, args, ["sensitive"])).toBe(true);
			expect(await orpcRefuses(procedure, ["sensitive"])).toBe(true);

			const mcp = await requiredLevel((scopes) =>
				mcpRefuses(tool.name, args, scopes),
			);
			const orpc = await requiredLevel((scopes) =>
				orpcRefuses(procedure, scopes),
			);
			if (mcp !== orpc) {
				mismatches.push(`${tool.name}: ${mcp}, ${procedure}: ${orpc}`);
			}
		}
		expect(mismatches).toEqual([]);
	}, 60_000);

	test("WHEN a write key calls create_upload_link or run_intake_source THEN the tool refuses", async () => {
		const client = await connect(["read", "write"]);
		for (const [name, args] of [
			["create_upload_link", { name: "Accountant" }],
			["run_intake_source", { id: "src_any" }],
		] as const) {
			const result = await client.callTool({ name, arguments: args });
			expect(isToolError(result)).toBe(true);
			expect(textOf(result)).toContain("`admin` scope");
		}
	});

	test("WHEN an admin key calls create_upload_link or run_intake_source THEN the tool succeeds", async () => {
		const rows = await db
			.insert(intakeSource)
			.values({
				type: "folder",
				name: "Scanner",
				enabled: true,
				config: {
					type: "folder",
					path: "/data/inbox",
					recursive: true,
					pollSeconds: 60,
					afterImport: "keep",
				},
				defaults: {},
			})
			.returning({ id: intakeSource.id });
		const sourceId = rows[0]?.id;
		if (!sourceId) throw new Error("intake source not inserted");
		// Only the queue is used by `runIntakeSourceNow`.
		const ingestion = {
			queue: { publishIntakePoll: async () => "job_1" },
		} as unknown as IngestionBinding;

		const client = await connect(["admin"], ingestion);
		const link = await client.callTool({
			name: "create_upload_link",
			arguments: { name: "Accountant" },
		});
		expect(isToolError(link)).toBe(false);
		expect(textOf(link)).toContain("/u/");

		const run = await client.callTool({
			name: "run_intake_source",
			arguments: { id: sourceId },
		});
		expect(isToolError(run)).toBe(false);
		expect(run.structuredContent).toMatchObject({
			id: sourceId,
			queued: true,
		});
	});
});
