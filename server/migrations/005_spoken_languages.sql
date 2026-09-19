UPDATE settings
SET value_json = json_set(
  value_json,
  '$.spokenLanguages', json('["en"]'),
  '$.defaults.spokenLanguages', json('["en"]')
)
WHERE name = 'preferences';

UPDATE runs
SET settings_json = json_set(
  settings_json,
  '$.spokenLanguages',
  json('["en"]')
);
