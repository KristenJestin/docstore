-- Custom SQL migration file, put your code below! -----
-- Rules become "automations" with a reduced, cross-cutting scope: the
-- `set_category` action is removed (classification now goes exclusively
-- through document types). Strip any leftover `set_category` entry from the
-- existing `rule.actions` arrays.
UPDATE "rule" SET "actions" = coalesce((
	SELECT jsonb_agg("action")
	FROM jsonb_array_elements("rule"."actions") AS "action"
	WHERE "action"->>'type' <> 'set_category'
), '[]'::jsonb)
WHERE "actions" @> '[{"type": "set_category"}]'::jsonb;
