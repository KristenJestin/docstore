import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";

/**
 * Data migrations replayed on a throwaway database, with legacy rows inserted
 * just before the migration under test — the only way to exercise SQL that
 * only runs once on a populated schema.
 *
 * - `0011_document-types`: the Series rows become document types, with their
 *   overrides and their reminders re-attached.
 * - `0012_extraction-in-types`: every type gets a default layout, and the
 *   extraction rules that lived outside any type move into a generic
 *   `Any <Category>` type.
 * - `0013_automations-scope`: the `set_category` rule action is removed;
 *   leftover entries are stripped from the existing `rule.actions` arrays.
 * - `0016_normalize-identifiers`: the stored `party.identifiers` are rewritten
 *   in the canonical form every lookup now normalizes to.
 * - `0017_fix-orphan-date-precision`: a `date_precision` left behind by a
 *   cleared `document_date` is dropped.
 * - `0018_normalize-domains`: the stored `domain` identifiers are reduced to
 *   the bare host every lookup now normalizes to.
 * - `0019_revoke-sensitive-share-links`: public links left open on sensitive
 *   content are closed.
 *
 * The tests run in order on the same database: each one replays the migrations
 * between the previous target and its own.
 */

dotenv.config({
	path: fileURLToPath(new URL("../../../apps/server/.env", import.meta.url)),
	quiet: true,
});

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("./migrations", import.meta.url),
);
const DATABASE = "docstore_test_migration";
/** Migrations replayed by the tests; everything before them is just setup. */
const TARGET_TAG = "0011_document-types";
const EXTRACTION_TAG = "0012_extraction-in-types";
const AUTOMATIONS_SCOPE_TAG = "0013_automations-scope";
const NORMALIZE_IDENTIFIERS_TAG = "0016_normalize-identifiers";
const ORPHAN_PRECISION_TAG = "0017_fix-orphan-date-precision";
const NORMALIZE_DOMAINS_TAG = "0018_normalize-domains";
const REVOKE_SENSITIVE_TAG = "0019_revoke-sensitive-share-links";

type Journal = { entries: { idx: number; tag: string }[] };

function migrationTags(): string[] {
	const journal = JSON.parse(
		readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
	) as Journal;
	return [...journal.entries]
		.sort((a, b) => a.idx - b.idx)
		.map((entry) => entry.tag);
}

function statementsOf(tag: string): string[] {
	const sql = readFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), "utf8");
	return sql
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}

function withDatabase(connectionString: string, database: string): string {
	const url = new URL(connectionString);
	url.pathname = `/${database}`;
	return url.toString();
}

let pool: Pool;

/** Creating a database and replaying every migration outlives the 5 s default. */
const SETUP_TIMEOUT_MS = 60_000;

beforeAll(async () => {
	const connectionString = process.env.DATABASE_URL_TEST;
	if (!connectionString) {
		throw new Error("DATABASE_URL_TEST is required for DB integration tests.");
	}

	const admin = new Pool({
		connectionString: withDatabase(connectionString, "postgres"),
		max: 1,
	});
	try {
		const found = await admin.query(
			"select 1 from pg_database where datname = $1",
			[DATABASE],
		);
		// `42P04`: another runner won the race, which is as good as creating it.
		if (found.rowCount === 0) {
			await admin.query(`create database "${DATABASE}"`).catch((error) => {
				if ((error as { code?: string }).code !== "42P04") throw error;
			});
		}
	} finally {
		await admin.end();
	}

	pool = new Pool({
		connectionString: withDatabase(connectionString, DATABASE),
		max: 1,
	});
	// Emptied rather than dropped: `drop database` waits on every other
	// connection, which turns a parallel test run into a deadlock.
	await pool.query("drop schema public cascade");
	await pool.query("create schema public");
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
	await pool?.end();
});

describe("0011_document-types", () => {
	test(
		"turns the existing Series into document types",
		async () => {
			const tags = migrationTags();
			const targetIndex = tags.indexOf(TARGET_TAG);
			expect(targetIndex).toBeGreaterThan(0);

			for (const tag of tags.slice(0, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			// Legacy fixtures, in the shape the schema had before the migration.
			await pool.query(`
			insert into "user" (id, name, email, email_verified, created_at, updated_at)
			values ('usr_legacy', 'Legacy', 'legacy@example.test', true, now(), now())
		`);
			await pool.query(`
			insert into party (id, type, name) values ('prt_edf', 'company', 'EDF')
		`);
			await pool.query(`
			insert into category (id, name, slug) values ('cat_bill', 'Invoice', 'invoice')
		`);
			await pool.query(`
			insert into document (id, title, status, document_date, period_start, category_id, created_by_id)
			values ('doc_one', 'Invoice 2024-01', 'active', '2024-01-01', '2024-01-01', 'cat_bill', 'usr_legacy')
		`);
			await pool.query(`
			insert into series (id, name, party_id, category_id, periodicity, start_period, end_period, expected_day, grace_days, enabled)
			values ('ser_edf', 'EDF invoice', 'prt_edf', 'cat_bill', 'monthly', '2024-01-01', null, 5, 3, true)
		`);
			await pool.query(`
			insert into document_series_override (document_id, series_id, included)
			values ('doc_one', 'ser_edf', false)
		`);
			await pool.query(`
			insert into reminder (id, kind, series_id, due_date, period, message)
			values ('rem_gap', 'series_gap', 'ser_edf', '2024-02-08', '2024-02-01', 'Series "EDF invoice": no document for the period 2024-02.')
		`);

			for (const statement of statementsOf(TARGET_TAG)) {
				await pool.query(statement);
			}

			const types = await pool.query("select * from document_type order by id");
			expect(types.rowCount).toBe(1);
			const type = types.rows[0] as Record<string, unknown>;
			expect(type.id).toBe("dty_edf");
			expect(type.name).toBe("EDF invoice");
			expect(type.issuer_party_id).toBe("prt_edf");
			expect(type.category_id).toBe("cat_bill");
			expect(type.periodicity).toBe("monthly");
			expect(type.expected_day).toBe(5);
			expect(type.grace_days).toBe(3);
			expect(type.enabled).toBe(true);
			// Columns that did not exist on a Series fall back on their defaults.
			expect(type.tag_ids).toEqual([]);
			expect(type.sensitive_default).toBe(false);
			expect(type.detection).toBeNull();

			const overrides = await pool.query(
				"select * from document_type_override",
			);
			expect(overrides.rowCount).toBe(1);
			expect(overrides.rows[0]).toMatchObject({
				document_id: "doc_one",
				document_type_id: "dty_edf",
				included: false,
			});

			const reminders = await pool.query("select * from reminder");
			expect(reminders.rowCount).toBe(1);
			expect(reminders.rows[0]).toMatchObject({
				kind: "period_gap",
				document_type_id: "dty_edf",
			});

			const legacy = await pool.query(`
			select tablename from pg_tables
			where schemaname = 'public' and tablename in ('series', 'document_series_override')
		`);
			expect(legacy.rowCount).toBe(0);

			const periodicities = await pool.query(`
			select enumlabel from pg_enum
			where enumtypid = 'series_periodicity'::regtype
			order by enumsortorder
		`);
			expect(periodicities.rows.map((row) => row.enumlabel)).toEqual([
				"weekly",
				"monthly",
				"quarterly",
				"yearly",
			]);
		},
		SETUP_TIMEOUT_MS,
	);
});

describe("0012_extraction-in-types", () => {
	test(
		"gives every type a default layout and rehouses the orphan rules",
		async () => {
			const tags = migrationTags();
			const from = tags.indexOf(TARGET_TAG) + 1;
			const targetIndex = tags.indexOf(EXTRACTION_TAG);
			expect(targetIndex).toBeGreaterThan(from - 1);

			for (const tag of tags.slice(from, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			// A type with a layout of its own, one without any, and three
			// extraction rules living outside any layout.
			await pool.query(`
			insert into document_type (id, name, category_id)
			values ('dty_with', 'EDF invoice', 'cat_bill'), ('dty_bare', 'Bare type', null)
		`);
			await pool.query(`
			insert into document_type_layout (id, document_type_id, name, sort_order)
			values ('dtl_2024', 'dty_with', '2024', 0), ('dtl_2023', 'dty_with', '2023', 1)
		`);
			await pool.query(`
			insert into extraction_rule (id, name, target, strategy, postprocess, category_ids, layout_id)
			values
				('ext_scoped', 'Amount', '{"kind":"title"}', '{"kind":"regex","pattern":"x","group":1}', '[]', ARRAY['cat_bill'], null),
				('ext_global', 'Anywhere', '{"kind":"title"}', '{"kind":"regex","pattern":"y","group":1}', '[]', '{}', null),
				('ext_layout', 'In a layout', '{"kind":"title"}', '{"kind":"regex","pattern":"z","group":1}', '[]', '{}', 'dtl_2024')
		`);
			await pool.query(`
			insert into rule (id, name, condition, actions)
			values ('rul_legacy', 'Legacy', '{"op":"and","children":[]}', '[
				{"type": "add_tag", "tagId": "tag_1"},
				{"type": "run_extraction", "extractionRuleId": "ext_scoped"},
				{"type": "set_field", "fieldId": "cf_1", "extractionRuleId": "ext_scoped"},
				{"type": "set_field", "fieldId": "cf_2", "value": "ABC"}
			]'::jsonb)
		`);

			for (const statement of statementsOf(EXTRACTION_TAG)) {
				await pool.query(statement);
			}

			// Every type owns at least one layout, and exactly one default.
			const layouts = await pool.query(`
			select document_type_id, count(*) filter (where is_default) as defaults, count(*) as total
			from document_type_layout group by document_type_id
		`);
			// `dty_edf` (migrated by 0011), the two types above and the two
			// generic ones.
			expect(layouts.rowCount).toBe(5);
			for (const row of layouts.rows) {
				expect(Number(row.defaults)).toBe(1);
				expect(Number(row.total)).toBeGreaterThan(0);
			}
			// The pre-existing layouts stay, the first one becomes the default.
			const existing = await pool.query(
				"select id, is_default from document_type_layout where document_type_id = 'dty_with' order by sort_order",
			);
			expect(existing.rows.map((row) => row.id)).toEqual([
				"dtl_2024",
				"dtl_2023",
			]);
			expect(existing.rows[0]?.is_default).toBe(true);
			expect(existing.rows[1]?.is_default).toBe(false);

			// Two generic types: one per category of the orphan rules.
			const generic = await pool.query(
				"select id, name, category_id, enabled, detection from document_type where name like 'Any %' order by category_id nulls last",
			);
			expect(generic.rows.map((row) => row.name)).toEqual([
				"Any Invoice",
				"Any document",
			]);
			expect(generic.rows[0]?.category_id).toBe("cat_bill");
			expect(generic.rows[1]?.category_id).toBeNull();
			expect(generic.rows.every((row) => row.enabled === false)).toBe(true);
			expect(generic.rows.every((row) => row.detection === null)).toBe(true);

			const rules = await pool.query(`
			select e.id, l.document_type_id, l.is_default, t.name as type_name
			from extraction_rule e
			join document_type_layout l on l.id = e.layout_id
			join document_type t on t.id = l.document_type_id
			order by e.id
		`);
			expect(rules.rowCount).toBe(3);
			const byId = new Map(rules.rows.map((row) => [row.id, row]));
			expect(byId.get("ext_scoped")?.type_name).toBe("Any Invoice");
			expect(byId.get("ext_scoped")?.is_default).toBe(true);
			expect(byId.get("ext_global")?.type_name).toBe("Any document");
			// A rule already attached to a layout does not move.
			expect(byId.get("ext_layout")?.document_type_id).toBe("dty_with");

			const columns = await pool.query(`
			select column_name, is_nullable from information_schema.columns
			where table_name = 'extraction_rule' and column_name in ('layout_id', 'category_ids')
		`);
			expect(columns.rows).toEqual([
				{ column_name: "layout_id", is_nullable: "NO" },
			]);

			// The removed rule actions are stripped from the existing rules.
			const legacy = await pool.query(
				"select actions from rule where id = 'rul_legacy'",
			);
			expect(legacy.rows[0]?.actions).toEqual([
				{ type: "add_tag", tagId: "tag_1" },
				{ type: "set_field", fieldId: "cf_2", value: "ABC" },
			]);
		},
		SETUP_TIMEOUT_MS,
	);
});

describe("0013_automations-scope", () => {
	test(
		"strips the removed `set_category` action from existing rules",
		async () => {
			const tags = migrationTags();
			const from = tags.indexOf(EXTRACTION_TAG) + 1;
			const targetIndex = tags.indexOf(AUTOMATIONS_SCOPE_TAG);
			expect(targetIndex).toBeGreaterThan(from - 1);

			for (const tag of tags.slice(from, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			await pool.query(`
				insert into rule (id, name, condition, actions)
				values
					('rul_mixed', 'Mixed', '{"op":"and","children":[]}', '[
						{"type": "set_category", "categoryId": "cat_bill"},
						{"type": "add_tag", "tagId": "tag_1"}
					]'::jsonb),
					('rul_only_category', 'Only category', '{"op":"and","children":[]}', '[
						{"type": "set_category", "categoryId": null}
					]'::jsonb),
					('rul_untouched', 'Untouched', '{"op":"and","children":[]}', '[
						{"type": "add_tag", "tagId": "tag_2"}
					]'::jsonb)
			`);

			for (const statement of statementsOf(AUTOMATIONS_SCOPE_TAG)) {
				await pool.query(statement);
			}

			const rows = await pool.query(
				"select id, actions from rule where id in ('rul_mixed', 'rul_only_category', 'rul_untouched') order by id",
			);
			const byId = new Map(rows.rows.map((row) => [row.id, row.actions]));
			expect(byId.get("rul_mixed")).toEqual([
				{ type: "add_tag", tagId: "tag_1" },
			]);
			expect(byId.get("rul_only_category")).toEqual([]);
			expect(byId.get("rul_untouched")).toEqual([
				{ type: "add_tag", tagId: "tag_2" },
			]);
		},
		SETUP_TIMEOUT_MS,
	);
});

describe("0016_normalize-identifiers", () => {
	test(
		"rewrites the stored identifiers in their canonical form",
		async () => {
			const tags = migrationTags();
			const from = tags.indexOf(AUTOMATIONS_SCOPE_TAG) + 1;
			const targetIndex = tags.indexOf(NORMALIZE_IDENTIFIERS_TAG);
			expect(targetIndex).toBeGreaterThan(from - 1);

			for (const tag of tags.slice(from, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			await pool.query(`
				insert into party (id, type, name, identifiers)
				values
					('prt_spaced', 'company', 'Spaced', '{
						"siren": "812 345 678",
						"siret": "812.345.678.00013",
						"vat": "fr 12 812345678",
						"iban": ["FR76 3000 6000 0112 3456 7890 189"],
						"email": ["Contact@ACME.FR", "contact@acme.fr"],
						"domain": ["ACME.fr"],
						"customerRef": " ABC-123 "
					}'::jsonb),
					('prt_clean', 'company', 'Clean', '{"siren": "900000019"}'::jsonb),
					('prt_empty', 'company', 'Empty', '{}'::jsonb)
			`);

			for (const statement of statementsOf(NORMALIZE_IDENTIFIERS_TAG)) {
				await pool.query(statement);
			}

			const rows = await pool.query(
				"select id, identifiers from party where id like 'prt_%' order by id",
			);
			const byId = new Map(rows.rows.map((row) => [row.id, row.identifiers]));

			expect(byId.get("prt_spaced")).toEqual({
				siren: "812345678",
				siret: "81234567800013",
				vat: "FR12812345678",
				iban: ["FR7630006000011234567890189"],
				// The two spellings collapse into one.
				email: ["contact@acme.fr"],
				domain: ["acme.fr"],
				customerRef: "ABC-123",
			});
			// Already canonical: untouched.
			expect(byId.get("prt_clean")).toEqual({ siren: "900000019" });
			expect(byId.get("prt_empty")).toEqual({});
		},
		SETUP_TIMEOUT_MS,
	);
});

describe("0017_fix-orphan-date-precision", () => {
	test(
		"drops a precision left behind by a cleared date",
		async () => {
			const tags = migrationTags();
			const from = tags.indexOf(NORMALIZE_IDENTIFIERS_TAG) + 1;
			const targetIndex = tags.indexOf(ORPHAN_PRECISION_TAG);
			expect(targetIndex).toBeGreaterThan(from - 1);

			for (const tag of tags.slice(from, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			await pool.query(`
				insert into document (id, title, status, document_date, date_precision, created_by_id)
				values
					('doc_orphan', 'Orphan precision', 'active', null, 'month', 'usr_legacy'),
					('doc_dated', 'Dated', 'active', '2026-03-08', 'day', 'usr_legacy'),
					('doc_bare', 'No date at all', 'active', null, null, 'usr_legacy')
			`);

			for (const statement of statementsOf(ORPHAN_PRECISION_TAG)) {
				await pool.query(statement);
			}

			const rows = await pool.query(
				"select id, document_date, date_precision from document where id like 'doc_%' order by id",
			);
			const byId = new Map(rows.rows.map((row) => [row.id, row]));
			expect(byId.get("doc_orphan")?.date_precision).toBeNull();
			// A row carrying both keeps them.
			expect(byId.get("doc_dated")?.date_precision).toBe("day");
			expect(byId.get("doc_bare")?.date_precision).toBeNull();
		},
		SETUP_TIMEOUT_MS,
	);
});

describe("0018_normalize-domains", () => {
	test(
		"reduces the stored domains to their bare host",
		async () => {
			const tags = migrationTags();
			const from = tags.indexOf(ORPHAN_PRECISION_TAG) + 1;
			const targetIndex = tags.indexOf(NORMALIZE_DOMAINS_TAG);
			expect(targetIndex).toBeGreaterThan(from - 1);

			for (const tag of tags.slice(from, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			await pool.query(`
				insert into party (id, type, name, identifiers)
				values
					('prt_urls', 'company', 'Urls', '{
						"domain": ["https://www.nordwind-digital.example/contact", "nordwind-digital.example", "acme.fr:8443", "https://"],
						"email": ["contact@nordwind-digital.example"]
					}'::jsonb),
					('prt_nodomain', 'company', 'No domain', '{"siren": "900000019"}'::jsonb)
			`);

			for (const statement of statementsOf(NORMALIZE_DOMAINS_TAG)) {
				await pool.query(statement);
			}

			const rows = await pool.query(
				"select id, identifiers from party where id in ('prt_urls', 'prt_nodomain') order by id",
			);
			const byId = new Map(rows.rows.map((row) => [row.id, row.identifiers]));
			const domains = (byId.get("prt_urls") as { domain: string[] }).domain;
			// The two spellings of the same host collapse, the port goes, the
			// scheme-only entry disappears.
			expect([...domains].sort()).toEqual([
				"acme.fr",
				"nordwind-digital.example",
			]);
			// Untouched keys keep their value.
			expect((byId.get("prt_urls") as { email: string[] }).email).toEqual([
				"contact@nordwind-digital.example",
			]);
			expect(byId.get("prt_nodomain")).toEqual({ siren: "900000019" });
		},
		SETUP_TIMEOUT_MS,
	);
});

describe("0019_revoke-sensitive-share-links", () => {
	test(
		"closes the public links left open on sensitive content",
		async () => {
			const tags = migrationTags();
			const from = tags.indexOf(NORMALIZE_DOMAINS_TAG) + 1;
			const targetIndex = tags.indexOf(REVOKE_SENSITIVE_TAG);
			expect(targetIndex).toBeGreaterThan(from - 1);

			for (const tag of tags.slice(from, targetIndex)) {
				for (const statement of statementsOf(tag)) {
					await pool.query(statement);
				}
			}

			await pool.query(`
				insert into document (id, title, status, sensitive, deleted_at, created_by_id)
				values
					('doc_secret', 'Blood test', 'active', true, null, 'usr_legacy'),
					('doc_plain', 'Lease', 'active', false, null, 'usr_legacy'),
					('doc_dropped', 'Old scan', 'active', true, now(), 'usr_legacy')
			`);
			await pool.query(`
				insert into dossier (id, name) values
					('dos_health', 'Health'), ('dos_home', 'Housing'), ('dos_gone', 'Archive')
			`);
			await pool.query(`
				insert into document_dossier (document_id, dossier_id) values
					('doc_secret', 'dos_health'),
					('doc_plain', 'dos_health'),
					('doc_plain', 'dos_home'),
					('doc_dropped', 'dos_gone')
			`);
			await pool.query(`
				insert into share_link (id, token, document_id, dossier_id, created_by_id, revoked_at, revoked_reason)
				values
					('shl_secret', 'tok_secret', 'doc_secret', null, 'usr_legacy', null, null),
					('shl_plain', 'tok_plain', 'doc_plain', null, 'usr_legacy', null, null),
					('shl_health', 'tok_health', null, 'dos_health', 'usr_legacy', null, null),
					('shl_home', 'tok_home', null, 'dos_home', 'usr_legacy', null, null),
					('shl_gone', 'tok_gone', null, 'dos_gone', 'usr_legacy', null, null),
					('shl_manual', 'tok_manual', 'doc_secret', null, 'usr_legacy', '2026-06-15T12:00:00', 'manual')
			`);

			for (const statement of statementsOf(REVOKE_SENSITIVE_TAG)) {
				await pool.query(statement);
			}

			const rows = await pool.query(
				"select id, revoked_at, revoked_reason from share_link order by id",
			);
			const byId = new Map(rows.rows.map((row) => [row.id, row]));

			expect(byId.get("shl_secret")?.revoked_reason).toBe("sensitive");
			expect(byId.get("shl_health")?.revoked_reason).toBe("sensitive");
			// Nothing sensitive behind them.
			expect(byId.get("shl_plain")?.revoked_at).toBeNull();
			expect(byId.get("shl_home")?.revoked_at).toBeNull();
			// The only sensitive document of the dossier is in the trash: the link
			// already serves nothing of it.
			expect(byId.get("shl_gone")?.revoked_at).toBeNull();
			// An already revoked link keeps its own reason and date.
			const manual = byId.get("shl_manual") as {
				revoked_at: Date;
				revoked_reason: string;
			};
			expect(manual.revoked_reason).toBe("manual");
			expect(manual.revoked_at.getUTCFullYear()).toBe(2026);
		},
		SETUP_TIMEOUT_MS,
	);
});
