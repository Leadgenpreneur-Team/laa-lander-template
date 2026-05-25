CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT,
  detail     TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
