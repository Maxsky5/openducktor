/**
 * The tables of the usage index. Bump `USAGE_INDEX_FORMAT_VERSION` with any change of the tables
 * or of the parser state that they keep, so the index rebuilds from the native history.
 */
export const USAGE_INDEX_FORMAT_VERSION = 9;

/** The lookup indexes of units. A read that fills an empty unit table builds them after it. */
export const USAGE_INDEX_UNIT_INDEXES = `
CREATE INDEX IF NOT EXISTS unit_by_key ON unit (unit_key);
CREATE INDEX IF NOT EXISTS unit_by_time ON unit (occurred_at_ms);
`;

export const USAGE_INDEX_DROP_UNIT_INDEXES = `
DROP INDEX IF EXISTS unit_by_key;
DROP INDEX IF EXISTS unit_by_time;
`;

export const USAGE_INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
-- The JSON text of the last downloaded rate catalog.
CREATE TABLE IF NOT EXISTS rate_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at_ms INTEGER NOT NULL,
  etag TEXT,
  document TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source (
  id INTEGER PRIMARY KEY,
  runtime TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  modified_at_ms REAL NOT NULL,
  file_id TEXT NOT NULL,
  resume_offset INTEGER,
  resume_digest TEXT,
  parser_state TEXT,
  issue_code TEXT,
  issue_first_ms INTEGER,
  issue_last_ms INTEGER
);
CREATE TABLE IF NOT EXISTS name (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (kind, value)
);
CREATE TABLE IF NOT EXISTS unit (
  source_id INTEGER NOT NULL,
  unit_key INTEGER NOT NULL,
  runtime TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  model_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  tier_id INTEGER NOT NULL,
  input INTEGER,
  cache_read INTEGER,
  cache_write_5m INTEGER,
  cache_write_1h INTEGER,
  output INTEGER,
  -- A database source holds the fork copies of a request, one for each session.
  PRIMARY KEY (source_id, unit_key, session_id)
) WITHOUT ROWID;
${USAGE_INDEX_UNIT_INDEXES}
CREATE TABLE IF NOT EXISTS day (
  local_date TEXT NOT NULL,
  runtime TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  model_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  input INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  output INTEGER NOT NULL,
  unmeasured INTEGER NOT NULL,
  unpriced_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  PRIMARY KEY (local_date, runtime, session_id, provider_id, model_id, project_id)
) WITHOUT ROWID;
`;

export const USAGE_INDEX_DROP_TABLES = `
DROP TABLE IF EXISTS day;
DROP TABLE IF EXISTS unit;
DROP TABLE IF EXISTS name;
DROP TABLE IF EXISTS source;
DROP TABLE IF EXISTS meta;
DROP TABLE IF EXISTS rate_catalog;
`;

export const USAGE_INDEX_TEMP_TABLES = `
CREATE TEMP TABLE IF NOT EXISTS touched (unit_key INTEGER PRIMARY KEY);
CREATE TEMP TABLE IF NOT EXISTS target (start_ms INTEGER PRIMARY KEY, end_ms INTEGER NOT NULL, local_date TEXT NOT NULL);
CREATE TEMP TABLE IF NOT EXISTS price (
  provider_id INTEGER NOT NULL, model_id INTEGER NOT NULL, tier_id INTEGER NOT NULL, min_prompt INTEGER NOT NULL,
  input REAL NOT NULL, cache_read REAL NOT NULL, cache_write_5m REAL NOT NULL, cache_write_1h REAL NOT NULL, output REAL NOT NULL,
  PRIMARY KEY (provider_id, model_id, tier_id, min_prompt)
) WITHOUT ROWID;
CREATE TEMP TABLE IF NOT EXISTS project_group (project_id INTEGER PRIMARY KEY, group_key TEXT NOT NULL);
CREATE TEMP TABLE IF NOT EXISTS report_period (idx INTEGER PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL);
`;

/**
 * Recomputes the rollup of the target dates. Copies of one request share a unit key. Tokens count
 * once, with the maximum of each field, at the copy whose source path sorts first. Every copy
 * counts as activity of its own session.
 */
export const USAGE_INDEX_ROLLUP_SQL = `
INSERT INTO day
WITH keys AS (
  SELECT DISTINCT u.unit_key FROM target t
  CROSS JOIN unit u INDEXED BY unit_by_time
    ON u.occurred_at_ms >= t.start_ms AND u.occurred_at_ms < t.end_ms
),
copies AS (
  SELECT u.runtime, u.occurred_at_ms, u.session_id, u.provider_id, u.model_id, u.project_id, u.tier_id,
    ROW_NUMBER() OVER k AS copy,
    MAX(u.input) OVER w AS input, MAX(u.cache_read) OVER w AS cache_read,
    MAX(u.cache_write_5m) OVER w AS cache_write_5m, MAX(u.cache_write_1h) OVER w AS cache_write_1h,
    MAX(u.output) OVER w AS output
  FROM keys CROSS JOIN unit u INDEXED BY unit_by_key ON u.unit_key = keys.unit_key
  JOIN source s ON s.id = u.source_id
  WINDOW w AS (PARTITION BY u.unit_key),
    k AS (PARTITION BY u.unit_key ORDER BY s.path, u.source_id)
),
placed AS (
  SELECT t.local_date, c.*,
    c.input IS NOT NULL AND c.cache_read IS NOT NULL AND c.cache_write_5m IS NOT NULL
      AND c.cache_write_1h IS NOT NULL AND c.output IS NOT NULL AS measured,
    p.provider_id IS NOT NULL AS priced,
    p.input AS r_input, p.cache_read AS r_cache_read, p.cache_write_5m AS r_cache_write_5m,
    p.cache_write_1h AS r_cache_write_1h, p.output AS r_output
  FROM copies c
  JOIN target t ON t.start_ms = (SELECT MAX(start_ms) FROM target WHERE start_ms <= c.occurred_at_ms)
    AND c.occurred_at_ms < t.end_ms
  -- The rate step of the largest prompt size below the prompt of the request.
  LEFT JOIN price p ON p.provider_id = c.provider_id AND p.model_id = c.model_id
    AND p.tier_id = c.tier_id
    AND p.min_prompt = (SELECT MAX(q.min_prompt) FROM price q
      WHERE q.provider_id = c.provider_id AND q.model_id = c.model_id AND q.tier_id = c.tier_id
        AND (q.min_prompt = 0
          OR c.input + c.cache_read + c.cache_write_5m + c.cache_write_1h > q.min_prompt))
),
counted AS (
  SELECT local_date, runtime, session_id, provider_id, model_id, project_id,
    copy = 1 AND measured AS tokens,
    copy = 1 AND NOT measured AS unmeasured,
    copy = 1 AND measured AND priced AS charged,
    input, cache_read, cache_write_5m, cache_write_1h, output,
    r_input, r_cache_read, r_cache_write_5m, r_cache_write_1h, r_output
  FROM placed
)
SELECT local_date, runtime, session_id, provider_id, model_id, project_id,
  SUM(CASE WHEN tokens THEN input ELSE 0 END),
  SUM(CASE WHEN tokens THEN cache_read ELSE 0 END),
  SUM(CASE WHEN tokens THEN cache_write_5m + cache_write_1h ELSE 0 END),
  SUM(CASE WHEN tokens THEN output ELSE 0 END),
  SUM(unmeasured),
  SUM(CASE WHEN tokens AND NOT charged
    THEN input + cache_read + cache_write_5m + cache_write_1h + output ELSE 0 END),
  TOTAL(CASE WHEN charged THEN (input * r_input + cache_read * r_cache_read
    + cache_write_5m * r_cache_write_5m + cache_write_1h * r_cache_write_1h
    + output * r_output) / 1000000.0 ELSE 0 END)
FROM counted
GROUP BY local_date, runtime, session_id, provider_id, model_id, project_id
`;
