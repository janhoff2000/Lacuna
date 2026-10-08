-- One row per app sampled by a market-transfer survey. A survey is far larger
-- than a task checkpoint can hold, and each row records how far that app got.
CREATE TABLE transfer_listings (
  run_id TEXT NOT NULL REFERENCES runs(id),
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  app_id TEXT NOT NULL,
  category TEXT NOT NULL,
  chart TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank >= 0),
  availability TEXT NOT NULL DEFAULT 'pending' CHECK(availability IN ('pending','available','unavailable','unknown')),
  checked_at INTEGER,
  cached INTEGER NOT NULL DEFAULT 0 CHECK(cached IN (0,1)),
  source_id TEXT REFERENCES sources(id),
  fit TEXT CHECK(fit IN ('transferable','market_specific','unclear','unscreened','no_details')),
  assessment_json TEXT CHECK(assessment_json IS NULL OR json_valid(assessment_json)),
  PRIMARY KEY(run_id, store, app_id)
) WITHOUT ROWID;
CREATE INDEX transfer_listings_progress ON transfer_listings(run_id, store, availability, rank);
