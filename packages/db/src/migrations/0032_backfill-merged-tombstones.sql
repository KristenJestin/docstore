-- Custom SQL migration file, put your code below! -----
-- Issue #2: a `doc_` id absorbed by `mergeAsVersion` must keep leading to the
-- kept document. Merges done before this release left no explicit record, only
-- their footprint: the absorbed document sits in the trash, has handed every
-- file over, and points at the kept one through a `version_of` relation. A
-- hand-made `version_of` never empties the files of its source, so that
-- footprint is what tells a merge apart. When a document carries several such
-- relations, the most recent one wins.
INSERT INTO "document_tombstone" ("document_id", "reason", "merged_into_id")
SELECT DISTINCT ON ("document"."id")
	"document"."id", 'merged', "document_relation"."to_document_id"
FROM "document"
INNER JOIN "document_relation"
	ON "document_relation"."from_document_id" = "document"."id"
	AND "document_relation"."kind" = 'version_of'
WHERE "document"."deleted_at" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM "document_file"
		WHERE "document_file"."document_id" = "document"."id"
	)
ORDER BY "document"."id", "document_relation"."created_at" DESC
ON CONFLICT ("document_id") DO NOTHING;
