CREATE TABLE settings (
  name TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','paused','completed','cancelled')),
  reason TEXT CHECK(reason IN ('app_review','user','budget','interrupted','error')),
  stage TEXT NOT NULL CHECK(stage IN ('discovery','candidate_review','collection','analysis','grouping','verification','report')),
  budget_usd REAL NOT NULL CHECK(budget_usd >= 0),
  coverage TEXT NOT NULL DEFAULT 'complete' CHECK(coverage IN ('complete','gaps')),
  coverage_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(coverage_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((status = 'paused' AND reason IS NOT NULL) OR status = 'cancelled' OR (status IN ('queued','running','completed') AND reason IS NULL))
);
CREATE UNIQUE INDEX one_active_run ON runs(status) WHERE status = 'running';
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage TEXT NOT NULL CHECK(stage IN ('discovery','candidate_review','collection','analysis','grouping','verification','report')),
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','retry','completed','failed','cancelled','superseded')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  attempt_id TEXT,
  next_retry_at INTEGER,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, stage, dedupe_key)
);
CREATE INDEX task_queue ON tasks(run_id, stage, status, next_retry_at);
CREATE UNIQUE INDEX one_active_task ON tasks(status) WHERE status = 'running';
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('listing','review','website')),
  identity_key TEXT NOT NULL,
  store TEXT CHECK(store IN ('apple','google')),
  app_id TEXT,
  review_id TEXT,
  locale TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  captured_at INTEGER NOT NULL,
  UNIQUE(kind, identity_key, content_hash, locale)
);
CREATE TABLE run_sources (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  collection_version TEXT NOT NULL,
  logical_review_key TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0,1)),
  counted INTEGER NOT NULL DEFAULT 0 CHECK(counted IN (0,1)),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  observed_at INTEGER NOT NULL,
  UNIQUE(run_id, source_id, task_id),
  CHECK(counted = 0 OR logical_review_key IS NOT NULL),
  CHECK(selected = 0 OR counted = 1)
);
CREATE UNIQUE INDEX one_counted_review ON run_sources(run_id, logical_review_key) WHERE counted = 1;
CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  stage TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  source_ids_json TEXT NOT NULL CHECK(json_valid(source_ids_json)),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  output_json TEXT NOT NULL CHECK(json_valid(output_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(stage, input_hash, model, prompt_version, schema_version)
);
CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  attempt_id TEXT NOT NULL,
  model TEXT NOT NULL,
  pricing_json TEXT NOT NULL CHECK(json_valid(pricing_json)),
  pricing_timestamp TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_flight','finalized','unknown')),
  reserved_usd REAL NOT NULL CHECK(reserved_usd >= 0),
  estimated_usd REAL CHECK(estimated_usd >= 0),
  known_charge_usd REAL CHECK(known_charge_usd >= 0),
  input_tokens INTEGER CHECK(input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens >= 0),
  provider_request_id TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(task_id, attempt_id)
);
CREATE UNIQUE INDEX one_ai_in_flight ON ai_requests(status) WHERE status = 'in_flight';
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  report_key TEXT NOT NULL,
  title TEXT NOT NULL,
  priority INTEGER NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
  report_json TEXT NOT NULL CHECK(json_valid(report_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(run_id, report_key)
);
CREATE TABLE saved_opportunities (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE REFERENCES opportunities(id),
  status TEXT NOT NULL DEFAULT 'saved' CHECK(status IN ('saved','exploring','dismissed')),
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER immutable_sources_update BEFORE UPDATE ON sources BEGIN SELECT RAISE(ABORT, 'Source snapshots are immutable'); END;
CREATE TRIGGER immutable_sources_delete BEFORE DELETE ON sources BEGIN SELECT RAISE(ABORT, 'Source snapshots are immutable'); END;
