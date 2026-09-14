-- A task may make multiple small sequential calls and one bounded repair. Every
-- dispatched call keeps its own reservation, even within one worker attempt.
CREATE TABLE ai_requests_next (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), task_id TEXT NOT NULL REFERENCES tasks(id),
  attempt_id TEXT NOT NULL, model TEXT NOT NULL, pricing_json TEXT NOT NULL CHECK(json_valid(pricing_json)), pricing_timestamp TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_flight','finalized','unknown')),
  reserved_usd REAL NOT NULL CHECK(reserved_usd >= 0), estimated_usd REAL CHECK(estimated_usd >= 0), known_charge_usd REAL CHECK(known_charge_usd >= 0),
  input_tokens INTEGER CHECK(input_tokens >= 0), output_tokens INTEGER CHECK(output_tokens >= 0), provider_request_id TEXT, error_code TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  prompt_version TEXT, schema_version TEXT, input_hash TEXT, provider_response_id TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  request_key TEXT NOT NULL DEFAULT 'default', UNIQUE(task_id,attempt_id,request_key)
);
INSERT INTO ai_requests_next(id,run_id,task_id,attempt_id,model,pricing_json,pricing_timestamp,status,reserved_usd,estimated_usd,known_charge_usd,input_tokens,output_tokens,provider_request_id,error_code,created_at,updated_at)
SELECT id,run_id,task_id,attempt_id,model,pricing_json,pricing_timestamp,status,reserved_usd,estimated_usd,known_charge_usd,input_tokens,output_tokens,provider_request_id,error_code,created_at,updated_at FROM ai_requests;
DROP TABLE ai_requests;
ALTER TABLE ai_requests_next RENAME TO ai_requests;
CREATE UNIQUE INDEX one_ai_in_flight ON ai_requests(status) WHERE status='in_flight';
CREATE INDEX ai_task_attempt ON ai_requests(task_id,attempt_id);
CREATE TABLE saved_opportunities_next (
  id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL UNIQUE REFERENCES opportunities(id),
  status TEXT NOT NULL DEFAULT 'to_investigate' CHECK(status IN ('to_investigate','investigating','consider','dismissed')),
  notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
INSERT INTO saved_opportunities_next SELECT id,opportunity_id,CASE status WHEN 'saved' THEN 'to_investigate' WHEN 'exploring' THEN 'investigating' ELSE status END,notes,created_at,updated_at FROM saved_opportunities;
DROP TABLE saved_opportunities;
ALTER TABLE saved_opportunities_next RENAME TO saved_opportunities;
