import type {
	ExtractionStrategy,
	ExtractionTarget,
	PostprocessStep,
} from "@docstore/shared/extraction";
import type {
	PlannedOperation,
	RuleAction,
	RuleCondition,
	RuleTrigger,
} from "@docstore/shared/rule";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { document } from "./document";
import { documentTypeLayout } from "./document-type";

/**
 * Unified rule engine (SPEC §3) and extraction rules (SPEC §4).
 *
 * The shapes of `condition`, `actions`, `target` and `strategy` are described
 * by the Zod schemas in `@docstore/shared`: the JSONB is validated at the API
 * boundary, never rebuilt by hand.
 */

export const rule = pgTable(
	"rule",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("rul_")),
		name: text("name").notNull(),
		description: text("description"),
		enabled: boolean("enabled").notNull().default(true),
		/** Ascending execution order: 0 runs before 1. */
		priority: integer("priority").notNull().default(0),
		triggers: text("triggers")
			.array()
			.$type<RuleTrigger[]>()
			.notNull()
			.default(sql`'{ingest}'::text[]`),
		condition: jsonb("condition").$type<RuleCondition>().notNull(),
		actions: jsonb("actions")
			.$type<RuleAction[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** Stops evaluating the following rules when this one matches. */
		stopOnMatch: boolean("stop_on_match").notNull().default(false),
		matchCount: integer("match_count").notNull().default(0),
		lastMatchedAt: timestamp("last_matched_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("rule_enabled_priority_idx").on(table.enabled, table.priority),
	],
);

export const extractionRule = pgTable(
	"extraction_rule",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("ext_")),
		name: text("name").notNull(),
		target: jsonb("target").$type<ExtractionTarget>().notNull(),
		strategy: jsonb("strategy").$type<ExtractionStrategy>().notNull(),
		postprocess: jsonb("postprocess")
			.$type<PostprocessStep[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		/**
		 * Layout owning the rule (SPEC §9): an extraction rule only ever exists
		 * inside a document type, and only runs when its layout is selected.
		 */
		layoutId: text("layout_id")
			.notNull()
			.references(() => documentTypeLayout.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("extraction_rule_layout_id_idx").on(table.layoutId)],
);

/** Execution log, purged beyond 90 days (`purgeRuleRuns`). */
export const ruleRun = pgTable(
	"rule_run",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("run_")),
		ruleId: text("rule_id")
			.notNull()
			.references(() => rule.id, { onDelete: "cascade" }),
		documentId: text("document_id")
			.notNull()
			.references(() => document.id, { onDelete: "cascade" }),
		matched: boolean("matched").notNull(),
		actionsApplied: jsonb("actions_applied")
			.$type<PlannedOperation[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		durationMs: integer("duration_ms").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("rule_run_rule_id_idx").on(table.ruleId),
		index("rule_run_document_id_idx").on(table.documentId),
		index("rule_run_created_at_idx").on(table.createdAt),
	],
);

export const ruleRelations = relations(rule, ({ many }) => ({
	runs: many(ruleRun),
}));

export const ruleRunRelations = relations(ruleRun, ({ one }) => ({
	rule: one(rule, { fields: [ruleRun.ruleId], references: [rule.id] }),
	document: one(document, {
		fields: [ruleRun.documentId],
		references: [document.id],
	}),
}));

export type RuleRow = typeof rule.$inferSelect;
export type NewRule = typeof rule.$inferInsert;
export type ExtractionRuleRow = typeof extractionRule.$inferSelect;
export type NewExtractionRule = typeof extractionRule.$inferInsert;
export type RuleRunRow = typeof ruleRun.$inferSelect;
export type NewRuleRun = typeof ruleRun.$inferInsert;
