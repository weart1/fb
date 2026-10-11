-- One row per (session, page, field). Form analytics: time per field, hesitation, refills, errors.
-- Field values are never collected; only interaction metadata.
CREATE TABLE IF NOT EXISTS form_fields
(
  project_id        LowCardinality(String),
  session_date      Date,
  path              String,
  field_name        LowCardinality(String),
  session_id        UUID,
  flow_id           SimpleAggregateFunction(any, LowCardinality(String)),
  step              SimpleAggregateFunction(max, UInt8),
  focuses           SimpleAggregateFunction(sum, UInt64),
  total_ms          SimpleAggregateFunction(sum, UInt64),
  hesitation_ms     SimpleAggregateFunction(sum, UInt64),
  filled            SimpleAggregateFunction(max, UInt8),
  refills           SimpleAggregateFunction(sum, UInt64),
  errors            SimpleAggregateFunction(sum, UInt64),
  first_focus_at    SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
  last_at           SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
  last_error        AggregateFunction(argMax, String, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(session_date)
ORDER BY (project_id, session_date, path, field_name, session_id)
TTL session_date + INTERVAL 395 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS form_fields_mv TO form_fields AS
SELECT
  project_id,
  toDate(session_start) AS session_date,
  path,
  field_name,
  session_id,
  any(flow_id) AS flow_id,
  max(step) AS step,
  countIf(event = '$form_field_focus') AS focuses,
  sumIf(duration_ms, event = '$form_field_blur') AS total_ms,
  sumIf(toUInt64(value), event = '$form_field_blur') AS hesitation_ms,
  maxIf(toUInt8(JSONExtractBool(properties, 'filled')), event = '$form_field_blur') AS filled,
  countIf(event = '$form_field_blur' AND JSONExtractBool(properties, 'refill')) AS refills,
  countIf(event = '$form_field_error') AS errors,
  min(ts) AS first_focus_at,
  max(ts) AS last_at,
  argMaxState(error_message, if(event = '$form_field_error', ts, toDateTime64(0, 3, 'UTC'))) AS last_error
FROM events
WHERE field_name != '' AND event IN ('$form_field_focus', '$form_field_blur', '$form_field_error')
GROUP BY project_id, session_date, path, field_name, session_id;
