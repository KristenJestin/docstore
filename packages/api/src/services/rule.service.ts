import type { Db } from "@docstore/db";
import { document } from "@docstore/db/schema/document";
import type { RuleRow } from "@docstore/db/schema/rule";
import { rule, ruleRun } from "@docstore/db/schema/rule";
import {
	applyRules,
	computeReviewReasons,
	getReviewSettings,
} from "@docstore/ingestion";
import type { Paginated } from "@docstore/shared/pagination";
import { paginationMeta } from "@docstore/shared/pagination";
import type {
	CreateRuleInput,
	ListRuleRunsInput,
	Rule,
	RuleRun,
	RunRulesInput,
	RunRulesResult,
	TestRuleInput,
	TestRuleResult,
	UpdateRuleInput,
} from "@docstore/shared/rule";
import { RULE_RUN_ALL_LIMIT } from "@docstore/shared/rule";
import { ORPCError } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	max,
} from "drizzle-orm";

/**
 * CRUD and execution of rules (SPEC §3).
 *
 * The evaluation itself is delegated to `@docstore/ingestion` (which calls
 * `@docstore/rules`): the API only handles validation, pagination and error
 * translation.
 */

export function listRules(db: Db): Promise<Rule[]> {
	return db
		.select()
		.from(rule)
		.orderBy(asc(rule.priority), asc(rule.createdAt), asc(rule.id));
}

export async function requireRule(db: Db, id: string): Promise<RuleRow> {
	const rows = await db.select().from(rule).where(eq(rule.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Rule "${id}" not found.`,
		});
	}
	return row;
}

export function getRule(db: Db, id: string): Promise<Rule> {
	return requireRule(db, id);
}

export async function createRule(
	db: Db,
	input: CreateRuleInput,
): Promise<Rule> {
	let priority = input.priority;
	if (priority === undefined) {
		const rows = await db.select({ value: max(rule.priority) }).from(rule);
		priority = (rows[0]?.value ?? -1) + 1;
	}

	const rows = await db
		.insert(rule)
		.values({
			name: input.name,
			description: input.description ?? null,
			enabled: input.enabled,
			priority,
			triggers: input.triggers,
			condition: input.condition,
			actions: input.actions,
			stopOnMatch: input.stopOnMatch,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The rule could not be created.",
		});
	}
	return row;
}

export async function updateRule(
	db: Db,
	input: UpdateRuleInput,
): Promise<Rule> {
	await requireRule(db, input.id);

	const patch: Partial<typeof rule.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) {
		patch.description = input.description ?? null;
	}
	if (input.enabled !== undefined) patch.enabled = input.enabled;
	if (input.priority !== undefined) patch.priority = input.priority;
	if (input.triggers !== undefined) patch.triggers = input.triggers;
	if (input.condition !== undefined) patch.condition = input.condition;
	if (input.actions !== undefined) patch.actions = input.actions;
	if (input.stopOnMatch !== undefined) patch.stopOnMatch = input.stopOnMatch;

	if (Object.keys(patch).length === 0) return requireRule(db, input.id);

	const rows = await db
		.update(rule)
		.set(patch)
		.where(eq(rule.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Rule "${input.id}" not found.`,
		});
	}
	return row;
}

export async function deleteRule(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireRule(db, id);
	await db.delete(rule).where(eq(rule.id, id));
	return { id, deleted: true };
}

/** The order of the array becomes the priority (0, 1, 2…). */
export async function reorderRules(db: Db, ids: string[]): Promise<Rule[]> {
	const unique = [...new Set(ids)];
	for (const id of unique) {
		await requireRule(db, id);
	}
	await db.transaction(async (tx) => {
		for (const [index, id] of unique.entries()) {
			await tx.update(rule).set({ priority: index }).where(eq(rule.id, id));
		}
	});
	return listRules(db);
}

export async function toggleRule(
	db: Db,
	id: string,
	enabled: boolean,
): Promise<Rule> {
	await requireRule(db, id);
	const rows = await db
		.update(rule)
		.set({ enabled })
		.where(eq(rule.id, id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Rule "${id}" not found.`,
		});
	}
	return row;
}

/** Synthetic rule built from an unpersisted draft. */
function draftRow(draft: NonNullable<TestRuleInput["rule"]>): RuleRow {
	const now = new Date();
	return {
		id: "rul_draft",
		name: draft.name,
		description: null,
		enabled: true,
		priority: 0,
		triggers: ["manual"],
		condition: draft.condition,
		actions: draft.actions,
		stopOnMatch: false,
		matchCount: 0,
		lastMatchedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

/** Test mode: evaluates the rule on a document without writing (SPEC §3). */
export async function testRule(
	db: Db,
	input: TestRuleInput,
): Promise<TestRuleResult> {
	const row = input.rule
		? draftRow(input.rule)
		: await requireRule(db, input.ruleId ?? "");

	const settings = await getReviewSettings(db);
	const result = await applyRules(db, input.documentId, {
		trigger: "manual",
		dryRun: true,
		includeDisabled: true,
		rules: [row],
		confidenceThreshold: settings.confidenceThreshold,
	});
	if (!result) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}

	const evaluated = result.rules[0];
	return {
		matched: evaluated?.matched ?? false,
		trace: evaluated?.trace ?? [],
		plannedActions: evaluated?.operations ?? [],
		extractions: evaluated?.extractions ?? [],
		// An automation whose `actions` array is empty matches and does nothing:
		// without this the caller cannot tell it apart from a rule that simply
		// did not match anything worth doing.
		hasActions: row.actions.length > 0,
		enabled: row.enabled,
	};
}

/**
 * Manual execution: on a selection of documents, or on all of them (capped at
 * `RULE_RUN_ALL_LIMIT` per call).
 */
export async function runRules(
	db: Db,
	input: RunRulesInput,
): Promise<RunRulesResult> {
	if (!input.documentIds && !input.all) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Provide `documentIds` or `all: true` to run the rules.",
		});
	}

	let documentIds = input.documentIds;
	if (documentIds) {
		// `all: true` already skips the trash; an explicit selection has to be
		// refused instead, or the actions would rewrite dropped documents
		// (SPEC §2).
		const trashed = await db
			.select({ id: document.id })
			.from(document)
			.where(
				and(
					inArray(document.id, [...new Set(documentIds)]),
					isNotNull(document.deletedAt),
				),
			);
		if (trashed.length > 0) {
			throw new ORPCError("CONFLICT", {
				message: `Document is in the trash; restore it first. (${trashed
					.map((row) => row.id)
					.join(", ")})`,
			});
		}
	}
	if (!documentIds) {
		const rows = await db
			.select({ id: document.id })
			.from(document)
			.where(isNull(document.deletedAt))
			.orderBy(desc(document.createdAt), asc(document.id))
			.limit(RULE_RUN_ALL_LIMIT);
		documentIds = rows.map((row) => row.id);
	}

	if (input.ruleId) {
		const target = await requireRule(db, input.ruleId);
		// A disabled automation is deliberately out of the loop: running it by
		// hand stays possible, but never by accident.
		if (!target.enabled && !input.force) {
			throw new ORPCError("BAD_REQUEST", {
				message: `The automation "${target.name}" is disabled. Re-run with \`force\` to run it anyway.`,
			});
		}
	}
	const settings = await getReviewSettings(db);

	let processed = 0;
	let matched = 0;
	for (const documentId of documentIds) {
		const result = await applyRules(db, documentId, {
			trigger: "manual",
			ruleIds: input.ruleId ? [input.ruleId] : undefined,
			// An explicit run applies even to a disabled rule.
			includeDisabled: Boolean(input.ruleId),
			confidenceThreshold: settings.confidenceThreshold,
		});
		if (!result) continue;
		processed += 1;
		if (result.matchedCount > 0) matched += 1;
		// A rule may have just filled in what was missing (category, issuer,
		// field…): refresh the review reasons instead of leaving stale ones.
		await computeReviewReasons(db, documentId);
	}

	return { processed, matched };
}

export async function listRuleRuns(
	db: Db,
	input: ListRuleRunsInput,
): Promise<Paginated<RuleRun>> {
	const conditions: SQL[] = [];
	if (input.ruleId) conditions.push(eq(ruleRun.ruleId, input.ruleId));
	if (input.documentId) {
		conditions.push(eq(ruleRun.documentId, input.documentId));
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const totalRows = await db
		.select({ value: count() })
		.from(ruleRun)
		.where(where);
	const total = totalRows[0]?.value ?? 0;

	const items = await db
		.select()
		.from(ruleRun)
		.where(where)
		.orderBy(desc(ruleRun.createdAt), desc(ruleRun.id))
		.limit(input.pageSize)
		.offset((input.page - 1) * input.pageSize);

	return { items, ...paginationMeta(total, input.page, input.pageSize) };
}
