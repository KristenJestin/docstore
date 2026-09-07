import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { eq, isNull } from "drizzle-orm";
import { category } from "./schema/category";
import { customField } from "./schema/custom-field";
import { documentType, documentTypeLayout } from "./schema/document-type";
import { extractionRule, rule } from "./schema/rule";
import { setting } from "./schema/setting";
import {
	repairSeedRules,
	SEED_APPLIED_AT_KEY,
	SEED_CATEGORIES,
	SEED_CUSTOM_FIELDS,
	SEED_DOCUMENT_TYPES,
	SEED_EXTRACTION_RULES,
	SEED_RULES,
	SEED_VERSION,
	SEED_VERSION_KEY,
	seedApplied,
	seedIfEmpty,
	seedTaxonomy,
} from "./seed";
import { createTestDb, type TestDb, truncateAll } from "./test-utils";

let db: TestDb;

beforeAll(async () => {
	db = await createTestDb();
});

afterAll(async () => {
	await db.$client.end();
});

beforeEach(async () => {
	await truncateAll(db);
});

const TOTAL_CATEGORIES = SEED_CATEGORIES.reduce(
	(total, node) => total + 1 + (node.children?.length ?? 0),
	0,
);

describe("seedTaxonomy", () => {
	test("inserts the full tree and the default fields", async () => {
		const result = await seedTaxonomy(db);
		expect(result.categoriesCreated).toBe(TOTAL_CATEGORIES);
		expect(result.customFieldsCreated).toBe(SEED_CUSTOM_FIELDS.length);

		const rows = await db.select().from(category);
		expect(rows).toHaveLength(TOTAL_CATEGORIES);

		const roots = await db
			.select()
			.from(category)
			.where(isNull(category.parentId));
		expect(roots).toHaveLength(SEED_CATEGORIES.length);

		const invoice = rows.find((row) => row.slug === "invoice");
		expect(invoice?.icon).toBe("receipt");
		const subscription = rows.find((row) => row.slug === "subscription");
		expect(subscription?.parentId).toBe(invoice?.id ?? "");

		const payslip = rows.find((row) => row.slug === "payslip");
		const fields = await db.select().from(customField);
		const net = fields.find((field) => field.slug === "net-pay");
		expect(net?.type).toBe("money");
		expect(net?.options.currency).toBe("EUR");
		expect(net?.categoryIds).toEqual([payslip?.id ?? ""]);

		const dueDate = fields.find((field) => field.slug === "due-date");
		expect(dueDate?.type).toBe("date");
		expect(dueDate?.categoryIds).toEqual([]);
	});

	test("is idempotent: a second pass inserts nothing", async () => {
		await seedTaxonomy(db);
		const second = await seedTaxonomy(db);

		expect(second.categoriesCreated).toBe(0);
		expect(second.customFieldsCreated).toBe(0);
		expect(await db.select().from(category)).toHaveLength(TOTAL_CATEGORIES);
		expect(await db.select().from(customField)).toHaveLength(
			SEED_CUSTOM_FIELDS.length,
		);
	});

	test("recreates only what is missing and does not overwrite existing rows", async () => {
		await seedTaxonomy(db);
		await db
			.update(category)
			.set({ name: "Supplier invoices", color: "#000000" })
			.where(eq(category.slug, "invoice"));
		await db.delete(customField).where(eq(customField.slug, "total-amount"));

		const result = await seedTaxonomy(db);
		expect(result.categoriesCreated).toBe(0);
		expect(result.customFieldsCreated).toBe(1);

		const rows = await db
			.select()
			.from(category)
			.where(eq(category.slug, "invoice"));
		expect(rows[0]?.name).toBe("Supplier invoices");
	});
});

describe("sample document type and rules", () => {
	test("puts the extraction rule in the Default layout of the seeded type", async () => {
		const result = await seedTaxonomy(db);
		expect(result.documentTypesCreated).toBe(SEED_DOCUMENT_TYPES.length);
		expect(result.extractionRulesCreated).toBe(SEED_EXTRACTION_RULES.length);
		expect(result.rulesCreated).toBe(SEED_RULES.length);

		const categories = await db.select().from(category);
		const payslipCategory = categories.find((row) => row.slug === "payslip");
		const types = await db.select().from(documentType);
		expect(types).toHaveLength(SEED_DOCUMENT_TYPES.length);
		const payslipType = types.find((row) => row.name === "Payslip");
		expect(payslipType?.categoryId).toBe(payslipCategory?.id ?? "");
		expect(payslipType?.periodicity).toBe("monthly");
		// Shipped disabled, exactly like the sample rules.
		expect(payslipType?.enabled).toBe(false);

		const layouts = await db.select().from(documentTypeLayout);
		expect(layouts).toHaveLength(1);
		expect(layouts[0]?.name).toBe("Default");
		expect(layouts[0]?.isDefault).toBe(true);
		expect(layouts[0]?.documentTypeId).toBe(payslipType?.id ?? "");

		const extractions = await db.select().from(extractionRule);
		const net = extractions.find((row) => row.name === "Net pay");
		expect(net?.strategy.kind).toBe("anchor");
		expect(net?.postprocess).toEqual(["number_fr"]);
		expect(net?.layoutId).toBe(layouts[0]?.id ?? "");

		const fields = await db.select().from(customField);
		const netField = fields.find((field) => field.slug === "net-pay");
		expect(net?.target).toEqual({ kind: "field", fieldId: netField?.id ?? "" });

		const rules = await db.select().from(rule);
		expect(rules).toHaveLength(SEED_RULES.length);
		expect(rules.every((row) => row.enabled)).toBe(false);

		const payslip = rules.find((row) => row.name === "Payslip by keyword");
		expect(payslip?.triggers).toEqual(["ingest", "manual"]);
		expect(payslip?.actions).toEqual([
			{ type: "set_document_type", documentTypeId: payslipType?.id ?? "" },
		]);

		const sensitive = rules.find(
			(row) => row.name === "Mark banking documents sensitive",
		);
		expect(sensitive?.actions).toEqual([
			{ type: "set_sensitive", sensitive: true },
		]);
	});

	test("renames a legacy 'Invoice by keyword' row instead of duplicating it", async () => {
		await db.insert(rule).values({
			name: "Invoice by keyword",
			description: "Legacy example, from a previous version of the seed.",
			enabled: false,
			priority: 0,
			triggers: ["ingest", "manual"],
			condition: { field: "content", cmp: "icontains", value: "facture" },
			actions: [],
		});

		const result = await seedTaxonomy(db);
		expect(result.rulesCreated).toBe(SEED_RULES.length);

		const rules = await db.select().from(rule);
		expect(rules).toHaveLength(SEED_RULES.length);
		expect(rules.some((row) => row.name === "Invoice by keyword")).toBe(false);

		const renamed = rules.find(
			(row) => row.name === "Mark banking documents sensitive",
		);
		expect(renamed?.actions).toEqual([
			{ type: "set_sensitive", sensitive: true },
		]);
	});

	test("a second pass inserts no type, layout, rule or extraction", async () => {
		await seedTaxonomy(db);
		const second = await seedTaxonomy(db);
		expect(second.documentTypesCreated).toBe(0);
		expect(second.rulesCreated).toBe(0);
		expect(second.extractionRulesCreated).toBe(0);
		expect(await db.select().from(documentType)).toHaveLength(
			SEED_DOCUMENT_TYPES.length,
		);
		expect(await db.select().from(documentTypeLayout)).toHaveLength(
			SEED_DOCUMENT_TYPES.length,
		);
		expect(await db.select().from(extractionRule)).toHaveLength(
			SEED_EXTRACTION_RULES.length,
		);
	});
});

describe("seedIfEmpty", () => {
	test("bootstraps a fresh database exactly once", async () => {
		expect(await seedApplied(db)).toBe(false);

		const first = await seedIfEmpty(db);
		expect(first?.categoriesCreated).toBe(TOTAL_CATEGORIES);
		expect(first?.rulesCreated).toBe(SEED_RULES.length);
		expect(await seedApplied(db)).toBe(true);

		expect(await seedIfEmpty(db)).toBeNull();
		expect(await db.select().from(category)).toHaveLength(TOTAL_CATEGORIES);
	});

	test("does not hand the defaults back to someone who deleted them", async () => {
		await seedIfEmpty(db);
		// The whole point of the marker: the user cleared the shipped taxonomy on
		// purpose, and every restart used to put it straight back.
		await db.delete(category);
		await db.delete(customField);

		expect(await seedIfEmpty(db)).toBeNull();
		expect(await db.select().from(category)).toHaveLength(0);
	});

	test("stamps the marker with the version of the taxonomy", async () => {
		await seedIfEmpty(db);
		const rows = await db.select().from(setting);
		const marker = rows.find((row) => row.key === SEED_APPLIED_AT_KEY);
		expect(typeof marker?.value).toBe("string");
		expect(rows.find((row) => row.key === SEED_VERSION_KEY)?.value).toBe(
			SEED_VERSION,
		);
	});

	test("an explicit seed re-applies whatever the marker says", async () => {
		await seedIfEmpty(db);
		await db.delete(category);

		// `bun run db:seed` and `db:reset` go straight through `seedTaxonomy`.
		const again = await seedTaxonomy(db);
		expect(again.categoriesCreated).toBe(TOTAL_CATEGORIES);
		expect(await db.select().from(category)).toHaveLength(TOTAL_CATEGORIES);
	});
});

describe("repairSeedRules", () => {
	test("refills an example automation left without any action", async () => {
		await seedTaxonomy(db);
		// Exactly the state migration `0013_automations-scope` leaves behind: the
		// only action of the example was stripped, the automation kept matching
		// and doing nothing (and `rule.test` returned an empty `plannedActions`).
		await db.update(rule).set({ actions: [] });

		expect(await repairSeedRules(db)).toBe(SEED_RULES.length);

		const rows = await db.select().from(rule);
		expect(rows).toHaveLength(SEED_RULES.length);
		expect(rows.every((row) => row.actions.length > 0)).toBe(true);
		// Still disabled: repairing an example never turns it on.
		expect(rows.every((row) => row.enabled === false)).toBe(true);
	});

	test("renames an example shipped under its previous name", async () => {
		await seedTaxonomy(db);
		const [definition] = SEED_RULES;
		if (!definition?.renamedFrom) throw new Error("missing renamedFrom");
		await db
			.update(rule)
			.set({ name: definition.renamedFrom, actions: [] })
			.where(eq(rule.name, definition.name));

		await repairSeedRules(db);
		const rows = await db
			.select()
			.from(rule)
			.where(eq(rule.name, definition.name));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.actions.length).toBeGreaterThan(0);
	});

	test("leaves an automation the user made their own alone", async () => {
		await seedTaxonomy(db);
		const [definition] = SEED_RULES;
		if (!definition) throw new Error("missing seed rule");
		// Enabled: it is no longer a shipped example, even without any action.
		await db
			.update(rule)
			.set({ actions: [], enabled: true })
			.where(eq(rule.name, definition.name));

		await repairSeedRules(db);
		const rows = await db
			.select()
			.from(rule)
			.where(eq(rule.name, definition.name));
		expect(rows[0]?.actions).toEqual([]);
	});

	test("is idempotent and does nothing on an intact seed", async () => {
		await seedTaxonomy(db);
		expect(await repairSeedRules(db)).toBe(0);
	});

	test("keeps quiet on a store that was never seeded", async () => {
		// No marker: those automations are not ours to put back.
		expect(await repairSeedRules(db)).toBe(0);
	});
});
