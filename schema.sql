CREATE TABLE IF NOT EXISTS modules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prototypes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  module_id   INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  preview_id  TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upload_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prototype_id INTEGER NOT NULL REFERENCES prototypes(id) ON DELETE CASCADE,
  file_name    TEXT    NOT NULL DEFAULT '',
  r2_key       TEXT    NOT NULL DEFAULT '',
  file_size    INTEGER NOT NULL DEFAULT 0,
  file_type    TEXT    NOT NULL DEFAULT '',
  upload_time  TEXT    NOT NULL DEFAULT (datetime('now')),
  uploader     TEXT    NOT NULL DEFAULT '',
  update_notes TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_prototypes_module_id   ON prototypes(module_id);
CREATE INDEX IF NOT EXISTS idx_prototypes_preview_id  ON prototypes(preview_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_proto_id ON upload_records(prototype_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  key_prefix   TEXT    NOT NULL,
  key_hash     TEXT    NOT NULL UNIQUE,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(revoked_at);
