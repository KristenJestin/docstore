-- The startup seed now keys off `seed.appliedAt` instead of "no category
-- exists". A store that already carries a taxonomy has plainly been seeded, so
-- it gets the marker here rather than a second helping of default categories.
INSERT INTO "settings" ("key", "value")
SELECT 'seed.appliedAt', to_jsonb(now()::text)
WHERE EXISTS (SELECT 1 FROM "category")
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "settings" ("key", "value")
SELECT 'seed.version', to_jsonb(1)
WHERE EXISTS (SELECT 1 FROM "category")
ON CONFLICT ("key") DO NOTHING;
