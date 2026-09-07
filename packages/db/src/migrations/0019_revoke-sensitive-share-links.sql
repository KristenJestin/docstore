-- Custom SQL migration file, put your code below! -----
-- SPEC §2: a sensitive document never leaves the store through a public URL.
-- `share_link.create` refuses one, and `setSensitive` / `addDossierDocuments`
-- close the windows already open — but those hooks were added after the fact.
-- Links minted before them, on a document that became sensitive (or on a
-- dossier that gained one), are still serving content today.
--
-- The same statement runs at every startup as `sweepSensitiveShareLinks`: this
-- migration is what fixes the stores already deployed, the sweep is what keeps
-- any future drift from lasting more than one restart.
UPDATE "share_link" SET "revoked_at" = now(), "revoked_reason" = 'sensitive'
WHERE "revoked_at" IS NULL
	AND (
		EXISTS (
			SELECT 1 FROM "document"
			WHERE "document"."id" = "share_link"."document_id"
				AND "document"."sensitive" = true
		)
		OR EXISTS (
			SELECT 1 FROM "document_dossier"
			INNER JOIN "document" ON "document"."id" = "document_dossier"."document_id"
			WHERE "document_dossier"."dossier_id" = "share_link"."dossier_id"
				AND "document"."sensitive" = true
				AND "document"."deleted_at" IS NULL
		)
	);
