import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCategories } from "@docstore/api/services/category.service";
import { listCustomFields } from "@docstore/api/services/custom-field.service";
import {
	assignAsn,
	getDocument,
	getDocumentStats,
	setDocumentTags,
	updateDocument,
} from "@docstore/api/services/document.service";
import {
	addLayout,
	applyDocumentType,
	createDocumentType,
	listDocumentTypes,
	listLayouts,
} from "@docstore/api/services/document-type.service";
import {
	addDossierDocuments,
	closeDossier,
	createDossier,
} from "@docstore/api/services/dossier.service";
import { createExtractionRule } from "@docstore/api/services/extraction-rule.service";
import {
	addPartyRelation,
	createParty,
} from "@docstore/api/services/party.service";
import type { LogoFetcher } from "@docstore/api/services/party-logo.service";
import { fetchPartyLogo } from "@docstore/api/services/party-logo.service";
import { addRelation } from "@docstore/api/services/relation.service";
import { generateReminders } from "@docstore/api/services/reminder.service";
import { listRules, toggleRule } from "@docstore/api/services/rule.service";
import { createSavedSearch } from "@docstore/api/services/saved-search.service";
import { createShareLink } from "@docstore/api/services/share-link.service";
import { createTag } from "@docstore/api/services/tag.service";
import type { Db } from "@docstore/db";
import { createDb } from "@docstore/db";
import { dropDatabase, prepareDatabase } from "@docstore/db/dev-db";
import { user } from "@docstore/db/schema/auth";
import type { IngestionContext } from "@docstore/ingestion";
import {
	createIngestionContext,
	intakeFile,
	isDuplicate,
	markProcessingFailed,
	processDocument,
	setSensitive,
	writeSetting,
} from "@docstore/ingestion";
import type { CategoryNode } from "@docstore/shared/category";
import type {
	DocumentStatus,
	UpdateDocumentInput,
} from "@docstore/shared/document";
import { deriveStorageMasterKey } from "@docstore/storage";
import {
	DEMO_DOCUMENT_TYPES,
	DEMO_DOSSIERS,
	DEMO_PARTIES,
	DEMO_PARTY_RELATIONS,
	DEMO_RELATIONS,
	DEMO_TAGS,
	HOUSEHOLD,
	type PlannedDocument,
	planDocuments,
} from "./demo-dataset";

/**
 * Demo dataset generator (`bun run db:demo`).
 *
 * Runs as a child of `scripts/demo.ts`, which resolves the workspace and hands
 * it the `DATABASE_URL` and `STORAGE_PATH` of the **current** checkout — the
 * same rule as `bun run db:reset`, so a worktree never writes into the main
 * database.
 *
 * Documents are not inserted: they are **ingested**. Each generated PDF goes
 * through `intakeFile` then `processDocument`, so the OCR text, the
 * thumbnails, the detected dates, the Party matching, the document types, the
 * extractions and the review reasons are the ones the product really produces.
 * The pipeline is driven synchronously here; pg-boss is not involved.
 */

interface Options {
	reset: boolean;
	force: boolean;
}

/** Login handed out with the demo library, when no account exists yet. */
export const DEMO_ACCOUNT = {
	email: "camille@example.com",
	password: "DemoPassword1!",
	name: "Camille",
} as const;

/**
 * The demo accepts a date read off the text of a document (confidence 0.6),
 * which the default threshold of 0.75 would send to the review queue. Without
 * it every single document would land in review and the queue would say
 * nothing about the three that are genuinely ambiguous.
 */
const DEMO_CONFIDENCE_THRESHOLD = 0.6;

function parseOptions(argv: string[]): Options {
	const options: Options = { reset: false, force: false };
	for (const arg of argv) {
		if (arg === "--reset") options.reset = true;
		else if (arg === "--force") options.force = true;
		else if (arg === "--yes" || arg === "-y") continue;
		else throw new Error(`unknown flag "${arg}".`);
	}
	return options;
}

function step(message: string): void {
	console.log(`[demo] ${message}`);
}

/* ------------------------------------------------------------------ */
/* Owner                                                                */
/* ------------------------------------------------------------------ */

/**
 * Documents need an owner (`created_by_id`). An existing account is reused;
 * on a fresh database the demo login is created through Better Auth itself, so
 * the password hash is the one the sign-in form expects.
 */
async function ensureOwner(db: Db): Promise<{ id: string; created: boolean }> {
	const existing = await db.select({ id: user.id }).from(user).limit(1);
	const found = existing[0];
	if (found) return { id: found.id, created: false };

	// Imported here rather than at the top: Better Auth opens a connection pool
	// of its own on load, and there is nothing to sign up when the store already
	// has an account.
	const { auth } = await import("@docstore/auth");
	await auth.api.signUpEmail({
		body: {
			email: DEMO_ACCOUNT.email,
			password: DEMO_ACCOUNT.password,
			name: DEMO_ACCOUNT.name,
		},
	});
	const created = await db.select({ id: user.id }).from(user).limit(1);
	const row = created[0];
	if (!row) throw new Error("The demo account could not be created.");
	return { id: row.id, created: true };
}

/* ------------------------------------------------------------------ */
/* Taxonomy lookups                                                     */
/* ------------------------------------------------------------------ */

function flattenCategories(nodes: CategoryNode[]): CategoryNode[] {
	return nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

async function categoryIdsBySlug(db: Db): Promise<Map<string, string>> {
	const nodes = flattenCategories(await listCategories(db));
	return new Map(nodes.map((node) => [node.slug, node.id]));
}

async function fieldIdsBySlug(db: Db): Promise<Map<string, string>> {
	const fields = await listCustomFields(db);
	return new Map(fields.map((field) => [field.slug, field.id]));
}

function required<T>(map: Map<string, T>, key: string, what: string): T {
	const value = map.get(key);
	if (value === undefined) throw new Error(`Unknown ${what}: "${key}".`);
	return value;
}

/* ------------------------------------------------------------------ */
/* Party logos                                                          */
/* ------------------------------------------------------------------ */

/** Time allowed to a favicon lookup before the demo moves on without it. */
const LOGO_TIMEOUT_MS = 4000;

/**
 * Fetches the favicon of every Party carrying a domain, best effort.
 *
 * It is what makes the directory look like a real one, and it is also the
 * feature being demonstrated. Nothing here is required: offline, behind a
 * proxy or on a domain that serves no icon, the generator simply keeps the
 * initials avatar and says how many it got.
 */
async function fetchLogos(
	db: Db,
	ctx: IngestionContext,
	partyIds: Map<string, string>,
): Promise<number> {
	const fetcher: LogoFetcher = async (url) => {
		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
			});
			if (!response.ok) return null;
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength === 0) return null;
			return {
				bytes: new Uint8Array(buffer),
				mime: response.headers.get("content-type") ?? "",
			};
		} catch {
			return null;
		}
	};

	let fetched = 0;
	for (const definition of DEMO_PARTIES) {
		if (!definition.identifiers?.domain?.length) continue;
		const id = partyIds.get(definition.key);
		if (!id) continue;
		try {
			await fetchPartyLogo(db, ctx.storage, id, fetcher);
			fetched += 1;
		} catch {
			// No icon on that domain, or no network: the initials stand in.
		}
	}
	return fetched;
}

/* ------------------------------------------------------------------ */
/* Rasterisation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Renders a one-page PDF to a grayscale PNG through poppler, the way a flatbed
 * scanner hands over an identity card: no text layer, so the pipeline really
 * runs Tesseract on it.
 */
async function rasterise(
	ctx: IngestionContext,
	pdf: Uint8Array,
): Promise<Uint8Array> {
	const dir = await mkdtemp(join(tmpdir(), "docstore-demo-scan-"));
	try {
		const source = join(dir, "page.pdf");
		await Bun.write(source, pdf);
		execFileSync(
			ctx.tools.pdftoppm,
			["-r", "150", "-png", "-gray", "-singlefile", source, join(dir, "scan")],
			{ stdio: "ignore" },
		);
		return new Uint8Array(await readFile(join(dir, "scan.png")));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Everything this generator reads from its environment. `scripts/demo.ts` set
 * it: `DATABASE_URL` and `STORAGE_PATH` already point at the current checkout,
 * the rest comes straight from `apps/server/.env`.
 */
const {
	DATABASE_URL,
	STORAGE_PATH,
	APP_SECRET,
	TESSERACT_PATH,
	TESSDATA_PREFIX,
	POPPLER_PATH,
} = process.env;

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	if (!DATABASE_URL || !STORAGE_PATH || !APP_SECRET) {
		throw new Error("DATABASE_URL, STORAGE_PATH and APP_SECRET are required.");
	}

	if (options.reset) {
		step("dropping and recreating the database…");
		await dropDatabase(DATABASE_URL);
	}
	const prepared = await prepareDatabase(DATABASE_URL);
	step(
		`database ${prepared.database} ready${prepared.seeded ? ", starter taxonomy seeded" : ""}.`,
	);

	const db = createDb(DATABASE_URL);
	try {
		await generate(db, {
			...options,
			storagePath: STORAGE_PATH,
			appSecret: APP_SECRET,
		});
	} finally {
		await db.$client.end();
	}
}

async function generate(
	db: Db,
	context: Options & { storagePath: string; appSecret: string },
): Promise<void> {
	const before = await getDocumentStats(db);
	if (before.total > 0 && !context.force) {
		throw new Error(
			`the database already holds ${before.total} document(s). Re-run with --reset to start from scratch, or --force to add the demo library on top.`,
		);
	}

	const ctx = createIngestionContext({
		db,
		storagePath: context.storagePath,
		tools: {
			tesseractPath: TESSERACT_PATH,
			tessdataPrefix: TESSDATA_PREFIX,
			popplerPath: POPPLER_PATH,
		},
		// Same derivation as the server: the files of the sensitive documents are
		// encrypted with the key the running application will read them back with.
		encryption: { masterKey: deriveStorageMasterKey(context.appSecret) },
	});

	const owner = await ensureOwner(db);
	step(
		owner.created
			? `demo account created: ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`
			: "existing account reused as the owner of the documents.",
	);

	await writeSetting(
		db,
		"review.confidenceThreshold",
		DEMO_CONFIDENCE_THRESHOLD,
	);

	const categories = await categoryIdsBySlug(db);
	const fields = await fieldIdsBySlug(db);

	/* -- Parties ---------------------------------------------------- */
	const partyIds = new Map<string, string>();
	for (const definition of DEMO_PARTIES) {
		const created = await createParty(db, {
			type: definition.type,
			name: definition.name,
			aliases: definition.aliases ?? [],
			identifiers: definition.identifiers ?? {},
			isHouseholdMember: definition.isHouseholdMember ?? false,
			...(definition.isHouseholdMember ? { userId: owner.id } : {}),
			...(definition.notes ? { notes: definition.notes } : {}),
		});
		partyIds.set(definition.key, created.id);
	}
	for (const relation of DEMO_PARTY_RELATIONS) {
		await addPartyRelation(db, {
			fromPartyId: required(partyIds, relation.from, "party"),
			toPartyId: required(partyIds, relation.to, "party"),
			kind: relation.kind,
			validFrom: relation.validFrom ?? null,
			validUntil: relation.validUntil ?? null,
		});
	}
	const logos = await fetchLogos(db, ctx, partyIds);
	step(
		`${partyIds.size} parties, ${DEMO_PARTY_RELATIONS.length} party relations, ${logos} logo(s) fetched.`,
	);

	/* -- Tags ------------------------------------------------------- */
	const tagIds = new Map<string, string>();
	for (const definition of DEMO_TAGS) {
		const created = await createTag(db, {
			name: definition.name,
			color: definition.color,
		});
		tagIds.set(definition.key, created.id);
	}

	/* -- Document types --------------------------------------------- */
	const typeIds = new Map<string, string>();
	const defaultLayoutIds = new Map<string, string>();
	for (const definition of DEMO_DOCUMENT_TYPES) {
		const created = await createDocumentType(db, {
			name: definition.name,
			description: definition.description,
			categoryId: required(categories, definition.categorySlug, "category"),
			issuerPartyId: definition.issuerKey
				? required(partyIds, definition.issuerKey, "party")
				: null,
			subjectPartyId: definition.subjectKey
				? required(partyIds, definition.subjectKey, "party")
				: null,
			tagIds: (definition.tagKeys ?? []).map((key) =>
				required(tagIds, key, "tag"),
			),
			sensitiveDefault: definition.sensitiveDefault ?? false,
			titleTemplate: definition.titleTemplate ?? null,
			detection: definition.detection,
			enabled: true,
			recurrence: definition.recurrence ?? null,
		});
		typeIds.set(definition.key, created.id);

		// `createDocumentType` always creates the Default layout; it is the only
		// one at this point, so it is the one to hang the shared rules on.
		const layouts = await listLayouts(db, created.id);
		const fallback = layouts[0];
		if (!fallback) throw new Error(`Type "${definition.name}" has no layout.`);
		defaultLayoutIds.set(definition.key, fallback.id);

		for (const extraction of definition.defaultExtractions ?? []) {
			await addExtraction(db, fallback.id, extraction, fields);
		}
		for (const layout of definition.layouts ?? []) {
			const added = await addLayout(db, {
				documentTypeId: created.id,
				name: layout.name,
				signature: layout.signature ?? null,
			});
			for (const extraction of layout.extractions ?? []) {
				await addExtraction(db, added.id, extraction, fields);
			}
		}
	}
	step(
		`${typeIds.size} document types with their layouts and extraction rules.`,
	);

	/* -- Automation -------------------------------------------------- */
	// The seed ships this one disabled; enabling it before the ingestion is what
	// flags the RIB and the bank statement sensitive on their way in.
	const rules = await listRules(db);
	const banking = rules.find(
		(item) => item.name === "Mark banking documents sensitive",
	);
	if (banking) await toggleRule(db, banking.id, true);
	step(
		banking
			? `automation "${banking.name}" enabled.`
			: "no shipped automation to enable.",
	);

	/* -- Documents --------------------------------------------------- */
	const planned = planDocuments();
	const documentIds = new Map<string, string>();
	let failed = 0;
	let duplicates = 0;

	for (const [index, plan] of planned.entries()) {
		const label = `${String(index + 1).padStart(2, "0")}/${planned.length} ${plan.filename}`;
		const outcome = await ingest(ctx, plan, {
			ownerId: owner.id,
			categories,
			partyIds,
			tagIds,
		});
		if (outcome.kind === "duplicate") {
			duplicates += 1;
			console.log(`[demo] ${label} — identical content, skipped`);
			continue;
		}
		documentIds.set(plan.key, outcome.documentId);
		if (outcome.kind === "failed") failed += 1;
		console.log(`[demo] ${label} — ${outcome.kind}`);
	}

	/* -- What a human does after the pipeline ------------------------ */
	for (const plan of planned) {
		const id = documentIds.get(plan.key);
		if (!id || plan.broken) continue;

		if (plan.applyTypeKey) {
			await applyDocumentType(db, {
				documentTypeId: required(typeIds, plan.applyTypeKey, "document type"),
				documentIds: [id],
				force: false,
			});
		}
		if (plan.tagKeys && plan.tagKeys.length > 0) {
			await setDocumentTags(
				db,
				id,
				plan.tagKeys.map((key) => required(tagIds, key, "tag")),
			);
		}
		const patch: UpdateDocumentInput = {
			...(plan.documentDate
				? { documentDate: plan.documentDate, datePrecision: "day" as const }
				: {}),
			...(plan.validUntil ? { validUntil: plan.validUntil } : {}),
			...(plan.physicalLocation
				? { physicalLocation: plan.physicalLocation }
				: {}),
		};
		if (Object.keys(patch).length > 0) await updateDocument(db, id, patch);
		if (plan.sensitive) {
			await updateDocument(
				db,
				id,
				{ sensitive: true },
				{
					onSensitiveChange: (documentId, sensitive) =>
						setSensitive(ctx, documentId, sensitive),
				},
			);
		}
		if (plan.asn) await assignAsn(db, id);
	}
	step(
		"types applied, tags, expiry dates, physical locations and ASNs written.",
	);

	/* -- Relations ---------------------------------------------------- */
	let relations = 0;
	for (const relation of DEMO_RELATIONS) {
		const from = documentIds.get(relation.fromKey);
		const to = documentIds.get(relation.toKey);
		if (!from || !to) continue;
		await addRelation(db, {
			fromDocumentId: from,
			toDocumentId: to,
			kind: relation.kind,
		});
		relations += 1;
	}

	/* -- Dossiers ----------------------------------------------------- */
	// Kept for the share link below: a dossier is the richest thing to hand
	// over through a public link.
	let sharedDossierId = "";
	for (const definition of DEMO_DOSSIERS) {
		const dossier = await createDossier(db, {
			name: definition.name,
			description: definition.description,
		});
		const ids = definition.documentKeys
			.map((key) => documentIds.get(key))
			.filter((value): value is string => Boolean(value));
		if (ids.length > 0) {
			await addDossierDocuments(db, { id: dossier.id, documentIds: ids });
		}
		if (definition.closed) await closeDossier(db, dossier.id);
		if (definition.shared) sharedDossierId = dossier.id;
	}

	/* -- Saved searches ------------------------------------------------ */
	await createSavedSearch(db, {
		name: "Expiring within 3 months",
		filters: {
			validUntilFrom: todayIso(),
			validUntilTo: addMonthsIso(3),
			deleted: "exclude",
			pageSize: 25,
			sort: "documentDate:desc",
		},
	});
	await createSavedSearch(db, {
		name: "2026 invoices",
		filters: {
			categoryId: required(categories, "invoice", "category"),
			year: 2026,
			deleted: "exclude",
			pageSize: 25,
			sort: "documentDate:desc",
		},
	});

	/* -- Share links --------------------------------------------------- */
	// One on a single document, one on the open dossier: the two shapes the
	// public `/s/<token>` page can take.
	const shared = documentIds.get("maif-attestation");
	let sharePath = "";
	if (shared) {
		const link = await createShareLink(db, owner.id, {
			documentId: shared,
			allowDownload: true,
			expiresAt: addMonthsIso(1, true),
		});
		// The path, not the absolute URL: the origin printed here would be the
		// one this script was given, not the one the app is being served on.
		sharePath = `/s/${link.link.token}`;
	}
	if (sharedDossierId) {
		const link = await createShareLink(db, owner.id, {
			dossierId: sharedDossierId,
			allowDownload: true,
			expiresAt: addMonthsIso(1, true),
		});
		sharePath = `/s/${link.link.token}`;
	}

	/* -- Reminders ------------------------------------------------------ */
	const reminders = await generateReminders(db);
	const types = await listDocumentTypes(db, {
		recurringOnly: true,
		includeDisabled: false,
	});
	const gaps = types.reduce(
		(total, type) => total + (type.stats?.missing.length ?? 0),
		0,
	);

	/* -- Summary --------------------------------------------------------- */
	const after = await getDocumentStats(db);
	console.log(
		[
			"",
			"  docstore demo library",
			`  household     ${HOUSEHOLD.owner}, ${HOUSEHOLD.partner}, ${HOUSEHOLD.child}`,
			`  documents     ${after.total} (${after.byStatus.active} active, ${after.byStatus.review} in review, ${after.byStatus.failed} failed)`,
			`  parties       ${partyIds.size}, ${DEMO_PARTY_RELATIONS.length} party relations`,
			`  types         ${typeIds.size}, ${gaps} missing period(s) detected`,
			`  tags          ${tagIds.size}`,
			`  dossiers      ${DEMO_DOSSIERS.length}, ${relations} document relations, 2 saved searches`,
			`  reminders     ${reminders.total} (${reminders.created} created by this run)`,
			`  storage       ${formatBytes(after.storage.bytes)} in ${after.storage.files} file(s)`,
			duplicates > 0
				? `  duplicates    ${duplicates} identical file(s) refused at intake`
				: "  duplicates    2 near-duplicates queued for review",
			sharePath ? `  share link    ${sharePath}` : "  share link    (none)",
			owner.created
				? `  login         ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`
				: "  login         existing account",
			"",
		].join("\n"),
	);
	if (failed > 0) {
		step(`${failed} upload(s) left in "failed" on purpose, to show the state.`);
	}
}

/* ------------------------------------------------------------------ */
/* Ingestion of one planned document                                    */
/* ------------------------------------------------------------------ */

type IngestOutcome =
	| { kind: DocumentStatus; documentId: string }
	| { kind: "duplicate" };

async function ingest(
	ctx: IngestionContext,
	plan: PlannedDocument,
	lookups: {
		ownerId: string;
		categories: Map<string, string>;
		partyIds: Map<string, string>;
		tagIds: Map<string, string>;
	},
): Promise<IngestOutcome> {
	const built = await plan.build();
	const data = plan.scan ? await rasterise(ctx, built) : built;
	const scanned = Boolean(plan.scan);
	const filename = scanned
		? plan.filename.replace(/\.pdf$/, ".png")
		: plan.filename;

	const result = await intakeFile(ctx, {
		data,
		filename,
		mime: scanned ? "image/png" : "application/pdf",
		createdById: lookups.ownerId,
		...(plan.title ? { title: plan.title } : {}),
		source: plan.source ?? "upload",
		...(plan.receivedAt ? { receivedAt: plan.receivedAt } : {}),
		defaults: {
			...(plan.categorySlug
				? {
						categoryId: required(
							lookups.categories,
							plan.categorySlug,
							"category",
						),
					}
				: {}),
			...(plan.issuerKey
				? { partyId: required(lookups.partyIds, plan.issuerKey, "party") }
				: {}),
			...(plan.tagKeys && plan.tagKeys.length > 0
				? {
						tagIds: plan.tagKeys.map((key) =>
							required(lookups.tagIds, key, "tag"),
						),
					}
				: {}),
		},
	});
	if (isDuplicate(result)) return { kind: "duplicate" };

	try {
		// One attempt only: a document meant to fail must reach `failed` rather
		// than sit in `processing` waiting for retries nobody will run.
		await processDocument(
			ctx,
			{ documentId: result.documentId, fileId: result.fileId },
			{ attempt: 1, maxAttempts: 1 },
		);
	} catch (error) {
		if (!plan.broken) throw error;
		await markProcessingFailed(ctx, result.documentId);
		return { kind: "failed", documentId: result.documentId };
	}

	const stored = await getDocument(ctx.db, result.documentId);
	return { kind: stored.status, documentId: result.documentId };
}

async function addExtraction(
	db: Db,
	layoutId: string,
	extraction: {
		name: string;
		fieldSlug: string;
		label: string;
		valuePattern: string;
		flags?: string;
	},
	fields: Map<string, string>,
): Promise<void> {
	await createExtractionRule(db, {
		name: extraction.name,
		target: {
			kind: "field",
			fieldId: required(fields, extraction.fieldSlug, "custom field"),
		},
		strategy: {
			kind: "anchor",
			label: extraction.label,
			position: "sameLine",
			valuePattern: extraction.valuePattern,
			...(extraction.flags ? { flags: extraction.flags } : {}),
		},
		postprocess: ["number_fr"],
		layoutId,
	});
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function addMonthsIso(count: number, withTime = false): string {
	const date = new Date();
	date.setUTCMonth(date.getUTCMonth() + count);
	return withTime ? date.toISOString() : date.toISOString().slice(0, 10);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"] as const;
	let value = bytes / 1024;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value.toFixed(1)} ${units[index] ?? "GB"}`;
}

main().catch((error) => {
	console.error(`[demo] ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
