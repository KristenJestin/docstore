import type {
	IntakeDefaults,
	IntakeSourceConfig,
	IntakeStats,
} from "@docstore/shared/intake";
import { INTAKE_OUTCOMES, INTAKE_SOURCE_TYPES } from "@docstore/shared/intake";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { user } from "./auth";
import { document } from "./document";

/**
 * Intake channels (SPEC §2 "Misc", §5): watched folders, mailboxes and public
 * upload links.
 *
 * The shape of `config` and `defaults` is described by the Zod schemas in
 * `@docstore/shared/intake`: the JSONB is validated at the API boundary.
 */

export const intakeSourceTypeEnum = pgEnum(
	"intake_source_type",
	INTAKE_SOURCE_TYPES,
);
export const intakeOutcomeEnum = pgEnum("intake_outcome", INTAKE_OUTCOMES);

export const intakeSource = pgTable(
	"intake_source",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("src_")),
		type: intakeSourceTypeEnum("type").notNull(),
		name: text("name").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		/**
		 * Key of the source in the server configuration file
		 * (`DOCSTORE_CONFIG`). Non-null = row owned by the file: rewritten at
		 * every startup by `syncManagedIntakeSources`, and read-only in the API.
		 */
		managedKey: text("managed_key").unique(),
		/** IMAP password encrypted (AES-256-GCM); never in plaintext. */
		config: jsonb("config").$type<IntakeSourceConfig>().notNull(),
		defaults: jsonb("defaults")
			.$type<IntakeDefaults>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		lastRunAt: timestamp("last_run_at"),
		lastError: text("last_error"),
		stats: jsonb("stats")
			.$type<IntakeStats>()
			.notNull()
			.default(sql`'{"imported":0,"duplicates":0,"errors":0}'::jsonb`),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("intake_source_enabled_idx").on(table.enabled)],
);

/** Intake log, purged beyond 30 days (`purgeIntakeLogs`). */
export const intakeLog = pgTable(
	"intake_log",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("ilg_")),
		sourceId: text("source_id")
			.notNull()
			.references(() => intakeSource.id, { onDelete: "cascade" }),
		documentId: text("document_id").references(() => document.id, {
			onDelete: "set null",
		}),
		filename: text("filename").notNull(),
		outcome: intakeOutcomeEnum("outcome").notNull(),
		message: text("message"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("intake_log_source_id_idx").on(table.sourceId),
		index("intake_log_created_at_idx").on(table.createdAt),
	],
);

export const uploadLink = pgTable(
	"upload_link",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("ulk_")),
		/** 32 random characters, exposed in the public URL `/u/<token>`. */
		token: text("token").notNull().unique(),
		name: text("name").notNull(),
		/** Text displayed to the sender. */
		message: text("message"),
		expiresAt: timestamp("expires_at"),
		/** `null` = unlimited. */
		maxUses: integer("max_uses"),
		uses: integer("uses").notNull().default(0),
		defaults: jsonb("defaults")
			.$type<IntakeDefaults>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		enabled: boolean("enabled").notNull().default(true),
		createdById: text("created_by_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("upload_link_enabled_idx").on(table.enabled)],
);

export const intakeSourceRelations = relations(intakeSource, ({ many }) => ({
	logs: many(intakeLog),
}));

export const intakeLogRelations = relations(intakeLog, ({ one }) => ({
	source: one(intakeSource, {
		fields: [intakeLog.sourceId],
		references: [intakeSource.id],
	}),
	document: one(document, {
		fields: [intakeLog.documentId],
		references: [document.id],
	}),
}));

export const uploadLinkRelations = relations(uploadLink, ({ one }) => ({
	createdBy: one(user, {
		fields: [uploadLink.createdById],
		references: [user.id],
	}),
}));

export type IntakeSourceRow = typeof intakeSource.$inferSelect;
export type NewIntakeSource = typeof intakeSource.$inferInsert;
export type IntakeLogRow = typeof intakeLog.$inferSelect;
export type NewIntakeLog = typeof intakeLog.$inferInsert;
export type UploadLinkRow = typeof uploadLink.$inferSelect;
export type NewUploadLink = typeof uploadLink.$inferInsert;
