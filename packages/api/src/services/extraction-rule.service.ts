import type { Db } from "@docstore/db";
import { customField } from "@docstore/db/schema/custom-field";
import { document } from "@docstore/db/schema/document";
import { documentTypeLayout } from "@docstore/db/schema/document-type";
import type { ExtractionRuleRow } from "@docstore/db/schema/rule";
import { extractionRule } from "@docstore/db/schema/rule";
import { loadExtractionInput } from "@docstore/ingestion";
import { runExtraction, toLayoutLines } from "@docstore/rules";
import type {
	ApplicableExtractionRulesInput,
	CreateExtractionRuleInput,
	ExtractionResult,
	ExtractionRule,
	ExtractionTarget,
	ListExtractionRulesInput,
	PreviewLayoutInput,
	PreviewLayoutResult,
	TestExtractionRuleInput,
	UpdateExtractionRuleInput,
} from "@docstore/shared/extraction";
import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";

/**
 * CRUD and trial runs for extraction rules (SPEC §4).
 */

/**
 * Rules of one layout, or of every layout of a document type. There is no
 * standalone listing: an extraction rule only exists inside a type (SPEC §9).
 */
export async function listExtractionRules(
	db: Db,
	input: ListExtractionRulesInput,
): Promise<ExtractionRule[]> {
	if (input.layoutId) {
		await requireLayout(db, input.layoutId);
		return db
			.select()
			.from(extractionRule)
			.where(eq(extractionRule.layoutId, input.layoutId))
			.orderBy(asc(extractionRule.name), asc(extractionRule.id));
	}

	const documentTypeId = input.documentTypeId;
	if (!documentTypeId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Provide either `layoutId` or `documentTypeId`.",
		});
	}

	const rows = await db
		.select({ rule: extractionRule })
		.from(extractionRule)
		.innerJoin(
			documentTypeLayout,
			eq(documentTypeLayout.id, extractionRule.layoutId),
		)
		.where(eq(documentTypeLayout.documentTypeId, documentTypeId))
		.orderBy(
			asc(documentTypeLayout.sortOrder),
			asc(extractionRule.name),
			asc(extractionRule.id),
		);
	return rows.map((row) => row.rule);
}

/**
 * Rules the "Extract" action can offer on a document: those of the layout its
 * type selected. Empty when the document carries no type or no layout.
 */
export async function applicableExtractionRules(
	db: Db,
	input: ApplicableExtractionRulesInput,
): Promise<ExtractionRule[]> {
	const rows = await db
		.select({ layoutId: document.layoutId })
		.from(document)
		.where(eq(document.id, input.documentId))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}
	if (!row.layoutId) return [];

	return db
		.select()
		.from(extractionRule)
		.where(eq(extractionRule.layoutId, row.layoutId))
		.orderBy(asc(extractionRule.name), asc(extractionRule.id));
}

/** A rule always belongs to an existing layout. */
async function requireLayout(db: Db, layoutId: string): Promise<void> {
	const rows = await db
		.select({ id: documentTypeLayout.id })
		.from(documentTypeLayout)
		.where(eq(documentTypeLayout.id, layoutId))
		.limit(1);
	if (!rows[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: `Layout "${layoutId}" not found.`,
		});
	}
}

export async function requireExtractionRule(
	db: Db,
	id: string,
): Promise<ExtractionRuleRow> {
	const rows = await db
		.select()
		.from(extractionRule)
		.where(eq(extractionRule.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Extraction rule "${id}" not found.`,
		});
	}
	return row;
}

export function getExtractionRule(db: Db, id: string): Promise<ExtractionRule> {
	return requireExtractionRule(db, id);
}

/** A `field` target must point at an existing custom field. */
async function assertTarget(db: Db, target: ExtractionTarget): Promise<void> {
	if (target.kind !== "field") return;
	const rows = await db
		.select({ id: customField.id })
		.from(customField)
		.where(eq(customField.id, target.fieldId))
		.limit(1);
	if (!rows[0]) {
		throw new ORPCError("NOT_FOUND", {
			message: `Custom field "${target.fieldId}" not found.`,
		});
	}
}

export async function createExtractionRule(
	db: Db,
	input: CreateExtractionRuleInput,
): Promise<ExtractionRule> {
	await assertTarget(db, input.target);
	await requireLayout(db, input.layoutId);
	const rows = await db
		.insert(extractionRule)
		.values({
			name: input.name,
			target: input.target,
			strategy: input.strategy,
			postprocess: input.postprocess,
			layoutId: input.layoutId,
		})
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "The extraction rule could not be created.",
		});
	}
	return row;
}

export async function updateExtractionRule(
	db: Db,
	input: UpdateExtractionRuleInput,
): Promise<ExtractionRule> {
	await requireExtractionRule(db, input.id);
	if (input.target) await assertTarget(db, input.target);

	const patch: Partial<typeof extractionRule.$inferInsert> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.target !== undefined) patch.target = input.target;
	if (input.strategy !== undefined) patch.strategy = input.strategy;
	if (input.postprocess !== undefined) patch.postprocess = input.postprocess;
	if (input.layoutId !== undefined) {
		await requireLayout(db, input.layoutId);
		patch.layoutId = input.layoutId;
	}

	if (Object.keys(patch).length === 0) {
		return requireExtractionRule(db, input.id);
	}

	const rows = await db
		.update(extractionRule)
		.set(patch)
		.where(eq(extractionRule.id, input.id))
		.returning();
	const row = rows[0];
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: `Extraction rule "${input.id}" not found.`,
		});
	}
	return row;
}

export async function deleteExtractionRule(
	db: Db,
	id: string,
): Promise<{ id: string; deleted: true }> {
	await requireExtractionRule(db, id);
	await db.delete(extractionRule).where(eq(extractionRule.id, id));
	return { id, deleted: true };
}

/** Tries a rule (persisted or draft) on a real document. */
export async function testExtractionRule(
	db: Db,
	input: TestExtractionRuleInput,
): Promise<ExtractionResult> {
	const definition = input.rule
		? {
				strategy: input.rule.strategy,
				postprocess: input.rule.postprocess,
			}
		: await requireExtractionRule(db, input.extractionRuleId ?? "");

	const source = await loadExtractionInput(db, input.documentId, input.fileId);
	if (!source) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}

	return runExtraction(definition.strategy, definition.postprocess, {
		text: source.text,
		layout: source.layout,
	});
}

/**
 * Rebuilt lines of the OCR layer: used to write an anchor while seeing
 * exactly what the engine sees.
 */
export async function previewLayout(
	db: Db,
	input: PreviewLayoutInput,
): Promise<PreviewLayoutResult> {
	const source = await loadExtractionInput(db, input.documentId, input.fileId);
	if (!source) {
		throw new ORPCError("NOT_FOUND", {
			message: `Document "${input.documentId}" not found.`,
		});
	}
	if (!source.fileId) {
		throw new ORPCError("NOT_FOUND", {
			message: "This document has no usable file.",
		});
	}

	return {
		fileId: source.fileId,
		pageCount: source.pageCount ?? source.layout?.pages.length ?? 0,
		lines: source.layout ? toLayoutLines(source.layout) : [],
	};
}
