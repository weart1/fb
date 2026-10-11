-- Index of session replay chunks stored in object storage (S3 key = replays/{project}/{session}/{seq}.json.gz).
CREATE TABLE IF NOT EXISTS replay_chunks
(
  project_id        LowCardinality(String),
  session_id        UUID,
  seq               UInt32,
  anonymous_id      UUID,
  first_ts          DateTime64(3, 'UTC'),
  last_ts           DateTime64(3, 'UTC'),
  events            UInt32,
  bytes             UInt32,
  object_key        String,
  received_at       DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(first_ts)
ORDER BY (project_id, session_id, seq)
TTL toDateTime(first_ts) + INTERVAL 30 DAY;

-- Page snapshots used as the background for heatmaps.
CREATE TABLE IF NOT EXISTS page_snapshots
(
  project_id        LowCardinality(String),
  path              String,
  step_key          LowCardinality(String),
  device_type       LowCardinality(String),
  viewport_w        UInt16,
  doc_h             UInt32,
  object_key        String,
  captured_at       DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(captured_at)
ORDER BY (project_id, path, step_key, device_type)
TTL toDateTime(captured_at) + INTERVAL 180 DAY;

-- Per-minute ingest health counters (accepted / dropped) for the data-quality panel.
CREATE TABLE IF NOT EXISTS ingest_stats
(
  project_id        LowCardinality(String),
  minute            DateTime('UTC'),
  accepted          UInt64,
  dropped_bot       UInt64,
  dropped_duplicate UInt64,
  dropped_invalid   UInt64,
  dropped_consent   UInt64
)
ENGINE = SummingMergeTree
ORDER BY (project_id, minute)
TTL minute + INTERVAL 90 DAY;
