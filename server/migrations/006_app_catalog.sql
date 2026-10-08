-- One row per store app ever observed. detail=1 rows come from a full listing
-- page; detail=0 rows hold only what a chart or search row carried.
CREATE TABLE apps (
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  app_id TEXT NOT NULL,
  title TEXT NOT NULL,
  developer TEXT NOT NULL,
  developer_id TEXT NOT NULL,
  category TEXT,
  description TEXT NOT NULL,
  country TEXT NOT NULL,
  language TEXT NOT NULL,
  detail INTEGER NOT NULL CHECK(detail IN (0,1)),
  source_id TEXT REFERENCES sources(id),
  summary TEXT,
  first_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(store, app_id)
);
-- Only definitive storefront answers are stored; a failed check leaves no row.
CREATE TABLE app_availability (
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  app_id TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available','unavailable')),
  checked_at INTEGER NOT NULL,
  PRIMARY KEY(store, app_id, country)
);
-- input_hash covers the listing text, focus, target language, model and prompt,
-- so a change to any of them is screened again.
CREATE TABLE transfer_screenings (
  store TEXT NOT NULL CHECK(store IN ('apple','google')),
  app_id TEXT NOT NULL,
  source_country TEXT NOT NULL,
  target_country TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  screened_at INTEGER NOT NULL,
  PRIMARY KEY(store, app_id, source_country, target_country, input_hash)
);

INSERT INTO apps(store,app_id,title,developer,developer_id,category,description,country,language,detail,source_id,first_seen_at,updated_at)
SELECT s.store, s.app_id, json_extract(s.payload_json,'$.title'),
  COALESCE(json_extract(s.payload_json,'$.developer'),''), COALESCE(json_extract(s.payload_json,'$.developerId'),''),
  json_extract(s.payload_json,'$.category'), COALESCE(json_extract(s.payload_json,'$.description'),''),
  COALESCE(json_extract(s.payload_json,'$.country'),''), COALESCE(json_extract(s.payload_json,'$.language'),''),
  1, s.id,
  (SELECT MIN(f.captured_at) FROM sources f WHERE f.kind='listing' AND f.identity_key=s.identity_key),
  s.captured_at
FROM sources s
WHERE s.kind='listing' AND s.store IS NOT NULL AND s.app_id IS NOT NULL
  AND s.id=(SELECT l.id FROM sources l WHERE l.kind='listing' AND l.identity_key=s.identity_key AND COALESCE(json_extract(l.payload_json,'$.title'),'')!='' ORDER BY l.captured_at DESC, l.id LIMIT 1);

INSERT INTO app_availability(store,app_id,country,status,checked_at)
SELECT s.store, s.app_id, json_extract(s.payload_json,'$.country'), 'available', MAX(s.captured_at)
FROM sources s
WHERE s.kind='listing' AND s.store IS NOT NULL AND s.app_id IS NOT NULL AND json_extract(s.payload_json,'$.country') GLOB '[A-Z][A-Z]'
GROUP BY s.store, s.app_id, json_extract(s.payload_json,'$.country');
