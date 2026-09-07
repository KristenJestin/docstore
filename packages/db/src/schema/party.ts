import type { PartyIdentifiers } from "@docstore/shared/party";
import { PARTY_RELATION_KINDS, PARTY_TYPES } from "@docstore/shared/party";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	date,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { createId } from "../id";
import { user } from "./auth";

export const partyTypeEnum = pgEnum("party_type", PARTY_TYPES);
export const partyRelationKindEnum = pgEnum(
	"party_relation_kind",
	PARTY_RELATION_KINDS,
);

/**
 * Entity: person, company, public body, association.
 * Household members are Parties (`is_household_member`).
 */
export const party = pgTable(
	"party",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("prt_")),
		type: partyTypeEnum("type").notNull(),
		name: text("name").notNull(),
		aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
		logoKey: text("logo_key"),
		identifiers: jsonb("identifiers")
			.$type<PartyIdentifiers>()
			.notNull()
			.default({}),
		isHouseholdMember: boolean("is_household_member").notNull().default(false),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		notes: text("notes"),
		archivedAt: timestamp("archived_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("party_name_idx").on(table.name),
		index("party_identifiers_gin_idx").using("gin", table.identifiers),
		index("party_userId_idx").on(table.userId),
	],
);

/** Typed and dated link between two Parties (employment, parentage, subsidiary…). */
export const partyRelation = pgTable(
	"party_relation",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId("rel_")),
		fromPartyId: text("from_party_id")
			.notNull()
			.references(() => party.id, { onDelete: "cascade" }),
		toPartyId: text("to_party_id")
			.notNull()
			.references(() => party.id, { onDelete: "cascade" }),
		kind: partyRelationKindEnum("kind").notNull(),
		validFrom: date("valid_from"),
		validUntil: date("valid_until"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("party_relation_from_idx").on(table.fromPartyId),
		index("party_relation_to_idx").on(table.toPartyId),
	],
);

export const partyRelations = relations(party, ({ one, many }) => ({
	user: one(user, {
		fields: [party.userId],
		references: [user.id],
	}),
	relationsFrom: many(partyRelation, { relationName: "party_relation_from" }),
	relationsTo: many(partyRelation, { relationName: "party_relation_to" }),
}));

export const partyRelationRelations = relations(partyRelation, ({ one }) => ({
	fromParty: one(party, {
		fields: [partyRelation.fromPartyId],
		references: [party.id],
		relationName: "party_relation_from",
	}),
	toParty: one(party, {
		fields: [partyRelation.toPartyId],
		references: [party.id],
		relationName: "party_relation_to",
	}),
}));

export type Party = typeof party.$inferSelect;
export type NewParty = typeof party.$inferInsert;
export type PartyRelationRow = typeof partyRelation.$inferSelect;
export type NewPartyRelation = typeof partyRelation.$inferInsert;
