-- One row per (session, flow, step). Powers the onboarding funnel, time-on-step percentiles,
-- drop-off user lists and step drill-down without scanning raw events.
-- Report filters are applied via `session_id IN (SELECT session_id FROM sessions WHERE ...)`.
CREATE TABLE IF NOT EXISTS flow_steps
(
  project_id        LowCardinality(String),
  flow_id           LowCardinality(String),
  session_date      Date,
  session_id        UUID,
  step              UInt8,
  step_name         SimpleAggregateFunction(any, LowCardinality(String)),
  anonymous_id      SimpleAggregateFunction(any, UUID),
  user_id           SimpleAggregateFunction(max, String),
  entered_at        SimpleAggregateFunction(min, Nullable(DateTime64(3, 'UTC'))),
  completed_at      SimpleAggregateFunction(min, Nullable(DateTime64(3, 'UTC'))),
  first_seen_at     SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
  last_seen_at      SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
  duration_ms       SimpleAggregateFunction(max, UInt32),
  views             SimpleAggregateFunction(sum, UInt64),
  events            SimpleAggregateFunction(sum, UInt64),
  clicks            SimpleAggregateFunction(sum, UInt64),
  rage_clicks       SimpleAggregateFunction(sum, UInt64),
  dead_clicks       SimpleAggregateFunction(sum, UInt64),
  errors            SimpleAggregateFunction(sum, UInt64),
  field_errors      SimpleAggregateFunction(sum, UInt64),
  backs             SimpleAggregateFunction(sum, UInt64),
  last_field        AggregateFunction(argMax, String, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(session_date)
ORDER BY (project_id, flow_id, session_date, session_id, step)
TTL session_date + INTERVAL 395 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS flow_steps_mv TO flow_steps AS
SELECT
  project_id,
  flow_id,
  toDate(session_start) AS session_date,
  session_id,
  step,
  any(step_name) AS step_name,
  any(anonymous_id) AS anonymous_id,
  max(user_id) AS user_id,
  minIf(toNullable(ts), event = 'onboarding_step_viewed') AS entered_at,
  minIf(toNullable(ts), event = 'onboarding_step_completed') AS completed_at,
  min(ts) AS first_seen_at,
  max(ts) AS last_seen_at,
  maxIf(duration_ms, event = 'onboarding_step_completed') AS duration_ms,
  countIf(event = 'onboarding_step_viewed') AS views,
  count() AS events,
  countIf(event = '$click') AS clicks,
  countIf(event = '$rage_click') AS rage_clicks,
  countIf(event = '$dead_click') AS dead_clicks,
  countIf(event = '$error') AS errors,
  countIf(event IN ('$form_field_error', 'onboarding_step_error')) AS field_errors,
  countIf(event = 'onboarding_step_back') AS backs,
  argMaxState(field_name, if(field_name != '', ts, toDateTime64(0, 3, 'UTC'))) AS last_field
FROM events
WHERE flow_id != '' AND step > 0
GROUP BY project_id, flow_id, session_date, session_id, step;
