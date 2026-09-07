ALTER TABLE "document_type_layout" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "document_type" ("id", "name", "description", "category_id", "enabled")
SELECT
	'dty_' || substr(md5('any:' || coalesce(orphan."category_id", 'none')), 1, 21),
	coalesce('Any ' || "category"."name", 'Any document'),
	'Generic type created by the migration: it holds the extraction rules that used to live outside any document type.',
	orphan."category_id",
	false
FROM (
	SELECT DISTINCT (
		SELECT "c"."id"
		FROM "category" "c"
		WHERE "c"."id" = ANY("extraction_rule"."category_ids")
		ORDER BY array_position("extraction_rule"."category_ids", "c"."id")
		LIMIT 1
	) AS "category_id"
	FROM "extraction_rule"
	WHERE "extraction_rule"."layout_id" IS NULL
) AS orphan
LEFT JOIN "category" ON "category"."id" = orphan."category_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "document_type_layout" ("id", "document_type_id", "name", "is_default", "sort_order")
SELECT
	'dtl_' || substr(md5('default:' || "document_type"."id"), 1, 21),
	"document_type"."id",
	'Default',
	true,
	0
FROM "document_type"
WHERE NOT EXISTS (
	SELECT 1 FROM "document_type_layout"
	WHERE "document_type_layout"."document_type_id" = "document_type"."id"
);--> statement-breakpoint
UPDATE "document_type_layout" SET "is_default" = true
WHERE "id" IN (
	SELECT DISTINCT ON ("document_type_id") "id"
	FROM "document_type_layout"
	ORDER BY "document_type_id", "sort_order", "id"
)
AND NOT EXISTS (
	SELECT 1 FROM "document_type_layout" AS "other"
	WHERE "other"."document_type_id" = "document_type_layout"."document_type_id"
		AND "other"."is_default"
);--> statement-breakpoint
UPDATE "extraction_rule" SET "layout_id" = (
	SELECT "document_type_layout"."id"
	FROM "document_type_layout"
	WHERE "document_type_layout"."document_type_id" = 'dty_' || substr(md5('any:' || coalesce((
			SELECT "c"."id"
			FROM "category" "c"
			WHERE "c"."id" = ANY("extraction_rule"."category_ids")
			ORDER BY array_position("extraction_rule"."category_ids", "c"."id")
			LIMIT 1
		), 'none')), 1, 21)
		AND "document_type_layout"."is_default"
	LIMIT 1
)
WHERE "layout_id" IS NULL;--> statement-breakpoint
ALTER TABLE "extraction_rule" DROP CONSTRAINT "extraction_rule_layout_id_document_type_layout_id_fk";
--> statement-breakpoint
ALTER TABLE "extraction_rule" ALTER COLUMN "layout_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_rule" ADD CONSTRAINT "extraction_rule_layout_id_document_type_layout_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."document_type_layout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_rule" DROP COLUMN "category_ids";--> statement-breakpoint
UPDATE "rule" SET "actions" = coalesce((
	SELECT jsonb_agg("action")
	FROM jsonb_array_elements("rule"."actions") AS "action"
	WHERE "action"->>'type' <> 'run_extraction'
		AND NOT ("action"->>'type' = 'set_field' AND "action" ? 'extractionRuleId')
), '[]'::jsonb)
WHERE "actions" @> '[{"type": "run_extraction"}]'::jsonb
	OR EXISTS (
		SELECT 1 FROM jsonb_array_elements("rule"."actions") AS "action"
		WHERE "action"->>'type' = 'set_field' AND "action" ? 'extractionRuleId'
	);
