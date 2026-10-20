-- Additive migration for live D1 databases: add the fbclid attribution column.
-- Safe to run on any existing lander DB — nullable, no data loss, no rewrite.
-- D1 has no "ADD COLUMN IF NOT EXISTS", so re-running errors with "duplicate column
-- name"; that error is the idempotency signal (column already present) — ignore it.
ALTER TABLE events ADD COLUMN fbclid TEXT;
