-- Additive migration for live D1 databases: add rounds.launched_at.
-- Powers the "Start Round" button — the days-running clock counts from when the team
-- clicks Start (client goes live), not from when the DB was created.
-- NULL for existing rounds until Start is clicked. Re-running errors "duplicate column
-- name" (idempotency signal) — ignore it.
ALTER TABLE rounds ADD COLUMN launched_at DATETIME;
