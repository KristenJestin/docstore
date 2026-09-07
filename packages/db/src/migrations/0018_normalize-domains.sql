-- Custom SQL migration file, put your code below! -----
-- `normalizeIdentifier("domain", …)` now reduces a domain to its bare host:
-- scheme, `www.`, port, path, query and trailing dot are stripped. Every lookup
-- normalizes its needle, so a value stored as "https://www.acme.fr/" would stop
-- matching the "acme.fr" it names.
UPDATE "party" SET "identifiers" = jsonb_set(
	"identifiers",
	'{domain}',
	coalesce(
		(
			SELECT jsonb_agg(DISTINCT "host")
			FROM (
				SELECT regexp_replace(
					regexp_replace(
						regexp_replace(
							regexp_replace(
								regexp_replace(lower(btrim("e")), '^[a-z][a-z0-9+.-]*://', ''),
								'[/?#].*$', ''
							),
							':[0-9]+$', ''
						),
						'^www\.', ''
					),
					'\.+$', ''
				) AS "host"
				FROM jsonb_array_elements_text("identifiers" -> 'domain') AS "e"
			) AS "hosts"
			WHERE "host" <> ''
		),
		'[]'::jsonb
	)
)
WHERE jsonb_typeof("identifiers" -> 'domain') = 'array';
