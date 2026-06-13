CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  round        INTEGER DEFAULT 1,
  variant      TEXT,
  event_type   TEXT,
  device       TEXT,
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
  archived     INTEGER DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rounds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  round_number    INTEGER UNIQUE,
  variant_a_label TEXT,
  variant_b_label TEXT,
  started_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT,
  detail     TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
