-- Custom SQL migration file, put your code below! -----
-- Party identifiers become canonical (`normalizeIdentifier` in
-- `@docstore/shared/party`): SIREN/SIRET/VAT/IBAN lose their spaces, dots and
-- dashes and go uppercase, emails and domains go lowercase. Without this pass
-- an identifier stored as "812 345 678" would never be found again by a lookup
-- that now normalizes its input.
UPDATE "party" SET "identifiers" = (
	SELECT coalesce(jsonb_object_agg("key", "value"), '{}'::jsonb)
	FROM (
		SELECT
			"k" AS "key",
			CASE
				WHEN "k" IN ('siren', 'siret', 'vat') AND jsonb_typeof("v") = 'string'
					THEN to_jsonb(upper(regexp_replace(btrim("v" #>> '{}'), '[[:space:].-]', '', 'g')))
				WHEN "k" = 'iban' AND jsonb_typeof("v") = 'array'
					THEN (
						SELECT coalesce(jsonb_agg(DISTINCT upper(regexp_replace(btrim("e"), '[[:space:].-]', '', 'g'))), '[]'::jsonb)
						FROM jsonb_array_elements_text("v") AS "e"
					)
				WHEN "k" IN ('email', 'domain') AND jsonb_typeof("v") = 'array'
					THEN (
						SELECT coalesce(jsonb_agg(DISTINCT lower(btrim("e"))), '[]'::jsonb)
						FROM jsonb_array_elements_text("v") AS "e"
					)
				WHEN "k" IN ('phone', 'customerRef') AND jsonb_typeof("v") = 'string'
					THEN to_jsonb(btrim("v" #>> '{}'))
				WHEN "k" = 'phone' AND jsonb_typeof("v") = 'array'
					THEN (
						SELECT coalesce(jsonb_agg(DISTINCT btrim("e")), '[]'::jsonb)
						FROM jsonb_array_elements_text("v") AS "e"
					)
				ELSE "v"
			END AS "value"
		FROM jsonb_each("party"."identifiers") AS "entry"("k", "v")
	) AS "normalized"
)
WHERE "identifiers" IS NOT NULL AND "identifiers" <> '{}'::jsonb;
