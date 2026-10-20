CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round        INTEGER DEFAULT 1,
  variant      TEXT,
  event_type   TEXT,
  device       TEXT,
  visitor_id   TEXT,
  lead_name    TEXT,
  lead_email   TEXT,
  lead_phone   TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  gclid        TEXT,
  campaign_id  TEXT,
  ad_group_id  TEXT,
  keyword      TEXT,
  match_type   TEXT,
  network      TEXT,
  fbclid       TEXT,
  archived     INTEGER DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rounds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_number    INTEGER UNIQUE,
  variant_a_label TEXT,
  variant_b_label TEXT,
  started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,  -- when the round row/DB was created
  launched_at     DATETIME,                             -- when the team clicked "Start Round" (client actually went live); NULL until then
  paused_at       DATETIME,                             -- set while the round is paused (clock frozen); NULL while running
  paused_seconds  INTEGER DEFAULT 0                     -- accumulated paused time from prior pauses, subtracted from days-running
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT,
  detail     TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
