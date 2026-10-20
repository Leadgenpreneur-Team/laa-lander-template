-- Additive migration for live D1 databases: pause/resume support on rounds.
-- paused_at = set while paused (clock frozen); paused_seconds = accumulated paused time
-- subtracted from the days-running clock so paused days don't count as running.
-- Run both lines; each errors "duplicate column name" if already applied (ignore).
ALTER TABLE rounds ADD COLUMN paused_at DATETIME;
ALTER TABLE rounds ADD COLUMN paused_seconds INTEGER DEFAULT 0;
