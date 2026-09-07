import type {
	ExtractionStrategy,
	ExtractionTarget,
	PostprocessStep,
} from "@docstore/shared/extraction";
import type { Periodicity } from "@docstore/shared/recurrence";
import { DEFAULT_GRACE_DAYS } from "@docstore/shared/recurrence";
import { DEFAULT_EXPIRY_LEAD_DAYS } from "@docstore/shared/reminder";
import type {
	RuleAction,
	RuleCondition,
	RuleTrigger,
} from "@docstore/shared/rule";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./index";
import { category } from "./schema/category";
import { customField } from "./schema/custom-field";
import { documentType, documentTypeLayout } from "./schema/document-type";
import { extractionRule, rule } from "./schema/rule";
import { setting } from "./schema/setting";

/**
 * Starter taxonomy: categories and custom fields commonly used by a French
 * household. The seed is **idempotent**: it only inserts what is missing and
 * never modifies an existing row.
 */

type SeedCategory = {
	slug: string;
	name: string;
	icon: string;
	color?: string;
	children?: SeedCategory[];
};

export const SEED_CATEGORIES: SeedCategory[] = [
	{
		slug: "invoice",
		name: "Invoice",
		icon: "receipt",
		color: "#f97316",
		children: [
			{ slug: "subscription", name: "Subscription", icon: "repeat" },
			{ slug: "purchase", name: "Purchase", icon: "shopping-cart" },
		],
	},
	{
		slug: "contract",
		name: "Contract",
		icon: "file-signature",
		color: "#6366f1",
		children: [
			{ slug: "employment", name: "Employment", icon: "briefcase" },
			{ slug: "insurance", name: "Insurance", icon: "shield-check" },
			{ slug: "housing", name: "Housing", icon: "house" },
		],
	},
	{
		slug: "proof",
		name: "Proof",
		icon: "file-check",
		color: "#0ea5e9",
		children: [
			{ slug: "identity", name: "Identity", icon: "id-card" },
			{ slug: "address", name: "Address", icon: "map-pin" },
			{ slug: "banking", name: "Banking", icon: "landmark" },
			{ slug: "administrative", name: "Administrative", icon: "stamp" },
		],
	},
	{
		slug: "payslip",
		name: "Payslip",
		icon: "banknote",
		color: "#22c55e",
	},
	{ slug: "taxes", name: "Taxes", icon: "percent", color: "#ef4444" },
	{ slug: "health", name: "Health", icon: "heart-pulse", color: "#ec4899" },
	{ slug: "mail", name: "Mail", icon: "mail", color: "#64748b" },
];

type SeedField = {
	slug: string;
	name: string;
	type: "text" | "money" | "date";
	options?: { currency?: string; choices?: string[] };
	/** Category slugs; empty = field visible everywhere. */
	categorySlugs?: string[];
};

export const SEED_CUSTOM_FIELDS: SeedField[] = [
	{
		slug: "total-amount",
		name: "Total amount",
		type: "money",
		options: { currency: "EUR" },
	},
	{
		slug: "net-pay",
		name: "Net pay",
		type: "money",
		options: { currency: "EUR" },
		categorySlugs: ["payslip"],
	},
	{
		slug: "invoice-number",
		name: "Invoice number",
		type: "text",
		categorySlugs: ["invoice"],
	},
	{ slug: "due-date", name: "Due date", type: "date" },
];

/**
 * Sample extraction rule: the net pay of a payslip, located by its French
 * label then converted to a number (SPEC §4). Extraction rules only exist
 * inside a document type, so it lives in the Default layout of `Payslip`.
 */
type SeedExtractionRule = {
	name: string;
	/** Slug of the targeted custom field; absent = another target. */
	fieldSlug?: string;
	target?: ExtractionTarget;
	strategy: ExtractionStrategy;
	postprocess: PostprocessStep[];
	/** Name of the seeded document type owning the rule. */
	documentTypeName: string;
};

export const SEED_EXTRACTION_RULES: SeedExtractionRule[] = [
	{
		name: "Net pay",
		fieldSlug: "net-pay",
		strategy: {
			kind: "anchor",
			// The anchor stays in French: it matches real French payslips.
			label: "NET (À|A) PAYER",
			position: "sameLine",
			valuePattern: "(\\d[\\d\\s.,]*\\d)",
		},
		postprocess: ["number_fr"],
		documentTypeName: "Payslip",
	},
];

/**
 * Sample document type, shipped **disabled** like the sample rules: a monthly
 * payslip, with the Default layout that carries the "Net pay" extraction.
 */
type SeedDocumentType = {
	name: string;
	description: string;
	categorySlug?: string;
	periodicity: Periodicity;
};

export const SEED_DOCUMENT_TYPES: SeedDocumentType[] = [
	{
		name: "Payslip",
		description:
			"Monthly payslip: carries the payslip category and the Net pay extraction.",
		categorySlug: "payslip",
		periodicity: "monthly",
	},
];

/** Name of the layout created with every document type. */
export const DEFAULT_LAYOUT_NAME = "Default";

/**
 * Sample automations, shipped **disabled**: they act as a starting point in
 * the UI without changing anything until the user enables them. Kept
 * cross-cutting on purpose (SPEC §3) — classifying similar documents is the
 * job of a document type, not an automation (`docs/document-types.md`,
 * "Types vs automations").
 */
type SeedRule = {
	name: string;
	description: string;
	priority: number;
	triggers: RuleTrigger[];
	condition: RuleCondition;
	/** Actions expressed with slugs, resolved to identifiers at seed time. */
	actions: SeedRuleAction[];
	/**
	 * Previous name of this automation, if it replaces one shipped by an
	 * earlier version of the seed: the row is renamed in place instead of
	 * being duplicated.
	 */
	renamedFrom?: string;
};

type SeedRuleAction =
	| { type: "set_sensitive"; sensitive: boolean }
	| { type: "set_document_type"; documentTypeName: string };

/** French IBAN, optionally grouped by 4 digits (SPEC §3). */
const IBAN_PATTERN = "FR\\d{2}(\\s?\\d{4}){5}\\s?\\d{3}";

export const SEED_RULES: SeedRule[] = [
	{
		name: "Mark banking documents sensitive",
		description:
			"Flags any document whose text contains a French IBAN as sensitive.",
		priority: 0,
		triggers: ["ingest", "manual"],
		condition: { field: "content", cmp: "regex", value: IBAN_PATTERN },
		actions: [{ type: "set_sensitive", sensitive: true }],
		// Replaces the former "Invoice by keyword" example, which relied on the
		// removed `set_category` action (classification now goes through
		// document types only).
		renamedFrom: "Invoice by keyword",
	},
	{
		name: "Payslip by keyword",
		description:
			'Applies the Payslip document type to any document whose text matches the French wording "bulletin de paie/salaire": its category, and the Net pay extraction of its layout.',
		priority: 1,
		triggers: ["ingest", "manual"],
		condition: {
			field: "content",
			cmp: "regex",
			// The matched value stays in French: it targets French document text.
			value: "bulletin de (paie|salaire)",
		},
		actions: [{ type: "set_document_type", documentTypeName: "Payslip" }],
		// Replaces the plain "Payslip" example, whose `set_category` action the
		// same migration removed.
		renamedFrom: "Payslip",
	},
];

/**
 * Settings shipped on first start. The other keys simply fall back to their
 * default value resolved on read (`getAllSettings`).
 */
export const SEED_SETTINGS: { key: string; value: unknown }[] = [
	{ key: "reminders.expiryLeadDays", value: [...DEFAULT_EXPIRY_LEAD_DAYS] },
];

export interface SeedResult {
	categoriesCreated: number;
	customFieldsCreated: number;
	documentTypesCreated: number;
	extractionRulesCreated: number;
	rulesCreated: number;
	settingsCreated: number;
}

/** Finds a category by (parent, slug) — the business unique key. */
async function findCategoryId(
	db: Db,
	parentId: string | null,
	slug: string,
): Promise<string | undefined> {
	const rows = await db
		.select({ id: category.id })
		.from(category)
		.where(
			and(
				eq(category.slug, slug),
				parentId === null
					? isNull(category.parentId)
					: eq(category.parentId, parentId),
			),
		)
		.limit(1);
	return rows[0]?.id;
}

async function upsertCategory(
	db: Db,
	node: SeedCategory,
	parentId: string | null,
	sortOrder: number,
	result: SeedResult,
	bySlug: Map<string, string>,
): Promise<void> {
	let id = await findCategoryId(db, parentId, node.slug);
	if (!id) {
		const rows = await db
			.insert(category)
			.values({
				parentId,
				name: node.name,
				slug: node.slug,
				icon: node.icon,
				color: node.color ?? null,
				sortOrder,
			})
			.returning({ id: category.id });
		id = rows[0]?.id;
		if (!id) {
			throw new Error(`Category "${node.slug}" was not inserted.`);
		}
		result.categoriesCreated += 1;
	}
	bySlug.set(node.slug, id);

	const children = node.children ?? [];
	for (const [index, child] of children.entries()) {
		await upsertCategory(db, child, id, index, result, bySlug);
	}
}

/**
 * Inserts the missing parts of the starter taxonomy. Can be called several
 * times without side effects (no update, no duplicate).
 */
export async function seedTaxonomy(db: Db): Promise<SeedResult> {
	const result: SeedResult = {
		categoriesCreated: 0,
		customFieldsCreated: 0,
		documentTypesCreated: 0,
		extractionRulesCreated: 0,
		rulesCreated: 0,
		settingsCreated: 0,
	};
	const bySlug = new Map<string, string>();
	const fieldIdBySlug = new Map<string, string>();

	for (const [index, node] of SEED_CATEGORIES.entries()) {
		await upsertCategory(db, node, null, index, result, bySlug);
	}

	for (const [index, field] of SEED_CUSTOM_FIELDS.entries()) {
		const existing = await db
			.select({ id: customField.id })
			.from(customField)
			.where(eq(customField.slug, field.slug))
			.limit(1);
		if (existing[0]) {
			fieldIdBySlug.set(field.slug, existing[0].id);
			continue;
		}
		const categoryIds = (field.categorySlugs ?? [])
			.map((slug) => bySlug.get(slug))
			.filter((value): value is string => Boolean(value));

		const inserted = await db
			.insert(customField)
			.values({
				name: field.name,
				slug: field.slug,
				type: field.type,
				options: field.options ?? {},
				categoryIds,
				sortOrder: index,
			})
			.returning({ id: customField.id });
		const id = inserted[0]?.id;
		if (id) fieldIdBySlug.set(field.slug, id);
		result.customFieldsCreated += 1;
	}

	const layoutIdByTypeName = await seedDocumentTypes(db, bySlug, result);
	await seedExtractionRules(db, layoutIdByTypeName, fieldIdBySlug, result);
	await seedRules(db, result);
	await seedSettings(db, result);

	return result;
}

/**
 * Sample document types, inserted disabled with their Default layout: an
 * extraction rule can only live inside one of them (SPEC §9).
 *
 * Returns the identifier of the Default layout of each type, by type name.
 */
async function seedDocumentTypes(
	db: Db,
	categoryIdBySlug: Map<string, string>,
	result: SeedResult,
): Promise<Map<string, string>> {
	const layoutIdByName = new Map<string, string>();

	for (const definition of SEED_DOCUMENT_TYPES) {
		const existing = await db
			.select({ id: documentType.id })
			.from(documentType)
			.where(eq(documentType.name, definition.name))
			.limit(1);

		let typeId = existing[0]?.id;
		if (!typeId) {
			const inserted = await db
				.insert(documentType)
				.values({
					name: definition.name,
					description: definition.description,
					categoryId: definition.categorySlug
						? (categoryIdBySlug.get(definition.categorySlug) ?? null)
						: null,
					// Disabled: an example, not imposed behaviour.
					enabled: false,
					periodicity: definition.periodicity,
					startPeriod: firstDayOfCurrentMonth(),
					graceDays: DEFAULT_GRACE_DAYS,
				})
				.returning({ id: documentType.id });
			typeId = inserted[0]?.id;
			if (!typeId) continue;
			result.documentTypesCreated += 1;
		}

		const layouts = await db
			.select({ id: documentTypeLayout.id })
			.from(documentTypeLayout)
			.where(eq(documentTypeLayout.documentTypeId, typeId))
			.orderBy(asc(documentTypeLayout.sortOrder), asc(documentTypeLayout.id))
			.limit(1);
		let layoutId = layouts[0]?.id;
		if (!layoutId) {
			const inserted = await db
				.insert(documentTypeLayout)
				.values({
					documentTypeId: typeId,
					name: DEFAULT_LAYOUT_NAME,
					isDefault: true,
					sortOrder: 0,
				})
				.returning({ id: documentTypeLayout.id });
			layoutId = inserted[0]?.id;
		}
		if (layoutId) layoutIdByName.set(definition.name, layoutId);
	}

	return layoutIdByName;
}

/** First day of the current month, the start of the seeded recurrence. */
function firstDayOfCurrentMonth(): string {
	const now = new Date();
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	return `${now.getUTCFullYear()}-${month}-01`;
}

/** Default settings, inserted without overwriting an existing value. */
async function seedSettings(db: Db, result: SeedResult): Promise<void> {
	for (const definition of SEED_SETTINGS) {
		const inserted = await db
			.insert(setting)
			.values({ key: definition.key, value: definition.value })
			.onConflictDoNothing()
			.returning({ key: setting.key });
		if (inserted[0]) {
			result.settingsCreated += 1;
		}
	}
}

/** Sample extraction rules, in the Default layout of their document type. */
async function seedExtractionRules(
	db: Db,
	layoutIdByTypeName: Map<string, string>,
	fieldIdBySlug: Map<string, string>,
	result: SeedResult,
): Promise<void> {
	for (const definition of SEED_EXTRACTION_RULES) {
		const layoutId = layoutIdByTypeName.get(definition.documentTypeName);
		if (!layoutId) continue;

		const existing = await db
			.select({ id: extractionRule.id })
			.from(extractionRule)
			.where(
				and(
					eq(extractionRule.name, definition.name),
					eq(extractionRule.layoutId, layoutId),
				),
			)
			.limit(1);
		if (existing[0]) continue;

		const target: ExtractionTarget | null = definition.fieldSlug
			? (() => {
					const fieldId = fieldIdBySlug.get(definition.fieldSlug);
					return fieldId ? { kind: "field" as const, fieldId } : null;
				})()
			: (definition.target ?? null);
		if (!target) continue;

		await db.insert(extractionRule).values({
			name: definition.name,
			target,
			strategy: definition.strategy,
			postprocess: definition.postprocess,
			layoutId,
		});
		result.extractionRulesCreated += 1;
	}
}

/** Resolves the slugs of a seed automation into typed rule actions. */
async function resolveRuleActions(
	db: Db,
	actions: SeedRuleAction[],
): Promise<RuleAction[]> {
	const resolved: RuleAction[] = [];
	for (const action of actions) {
		if (action.type === "set_sensitive") {
			resolved.push({ type: "set_sensitive", sensitive: action.sensitive });
			continue;
		}
		const types = await db
			.select({ id: documentType.id })
			.from(documentType)
			.where(eq(documentType.name, action.documentTypeName))
			.limit(1);
		const documentTypeId = types[0]?.id;
		if (documentTypeId) {
			resolved.push({ type: "set_document_type", documentTypeId });
		}
	}
	return resolved;
}

/**
 * Sample automations, inserted disabled. A definition carrying `renamedFrom`
 * renames the pre-existing row in place instead of inserting a new one, so
 * upgrading an already-seeded database does not leave an orphan example
 * behind next to its replacement.
 */
async function seedRules(db: Db, result: SeedResult): Promise<void> {
	for (const definition of SEED_RULES) {
		const existing = await db
			.select({ id: rule.id })
			.from(rule)
			.where(eq(rule.name, definition.name))
			.limit(1);
		if (existing[0]) continue;

		const actions = await resolveRuleActions(db, definition.actions);

		if (definition.renamedFrom) {
			const legacy = await db
				.select({ id: rule.id })
				.from(rule)
				.where(eq(rule.name, definition.renamedFrom))
				.limit(1);
			if (legacy[0]) {
				await db
					.update(rule)
					.set({
						name: definition.name,
						description: definition.description,
						priority: definition.priority,
						triggers: definition.triggers,
						condition: definition.condition,
						actions,
					})
					.where(eq(rule.id, legacy[0].id));
				result.rulesCreated += 1;
				continue;
			}
		}

		await db.insert(rule).values({
			name: definition.name,
			description: definition.description,
			// Disabled: they are examples, not imposed behaviour.
			enabled: false,
			priority: definition.priority,
			triggers: definition.triggers,
			condition: definition.condition,
			actions,
			stopOnMatch: false,
		});
		result.rulesCreated += 1;
	}
}

/**
 * Refills the shipped example automations that an earlier migration emptied.
 *
 * `0013_automations-scope` removed the `set_category` action, which left the
 * two examples with `actions: []` — they matched and did nothing, and
 * `rule.test` reported an empty `plannedActions` on a rule that looked fine.
 * Only touches a **disabled** example carrying **no** action, so a rule the
 * user made their own is never rewritten.
 *
 * Returns the number of automations repaired.
 */
export async function repairSeedRules(db: Db): Promise<number> {
	let repaired = 0;
	for (const definition of SEED_RULES) {
		const names = [definition.name];
		if (definition.renamedFrom) names.push(definition.renamedFrom);

		const rows = await db
			.select({ id: rule.id, actions: rule.actions, enabled: rule.enabled })
			.from(rule)
			.where(inArray(rule.name, names));
		const broken = rows.filter(
			(row) => !row.enabled && row.actions.length === 0,
		);
		if (broken.length === 0) continue;

		const actions = await resolveRuleActions(db, definition.actions);
		// Nothing to put back (the referenced document type is gone): leave the
		// row alone rather than rewriting it with an empty list again.
		if (actions.length === 0) continue;

		for (const row of broken) {
			await db
				.update(rule)
				.set({
					name: definition.name,
					description: definition.description,
					condition: definition.condition,
					triggers: definition.triggers,
					actions,
				})
				.where(eq(rule.id, row.id));
			repaired += 1;
		}
	}
	return repaired;
}

/**
 * Bootstraps the database on first start: does nothing if categories already
 * exist (the user may have deliberately deleted everything… but in that case
 * the table is no longer empty as soon as they create one again).
 */
export async function seedIfEmpty(db: Db): Promise<SeedResult | null> {
	const rows = await db.select({ value: count() }).from(category);
	if ((rows[0]?.value ?? 0) > 0) {
		return null;
	}
	return seedTaxonomy(db);
}

if (import.meta.main) {
	const { fileURLToPath } = await import("node:url");
	const dotenv = await import("dotenv");
	dotenv.default.config({
		path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
		quiet: true,
	});

	const { createDb } = await import("./index");
	const db = createDb();
	const result = await seedTaxonomy(db);
	console.log(
		`[seed] ${result.categoriesCreated} category(ies) and ${result.customFieldsCreated} field(s) created.`,
	);
	await db.$client.end();
}
