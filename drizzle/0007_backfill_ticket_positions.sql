-- Custom SQL migration file --
-- Custom migration (drizzle-kit generate --custom): tickets issued before
-- 0006 all received position = 1. Number them by issue order so
-- "ticket 2 of 3" is right for every existing order before the unique
-- (order_id, position) index in 0008.
UPDATE "tickets" t
SET "position" = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at, code) AS rn
  FROM "tickets"
) r
WHERE t.id = r.id;
