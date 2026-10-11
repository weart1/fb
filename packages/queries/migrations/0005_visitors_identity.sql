-- One row per anonymous visitor (browser). Visitor explorer list, first-seen cohorts.
CREATE TABLE IF NOT EXISTS visitors
(
  project_id        LowCardinality(String),
  anonymous_id      UUID,
  user_id           SimpleAggregateFunction(max, String),
  first_seen        SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
  last_seen         SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
  sessions          AggregateFunction(uniq, UUID),
  events            SimpleAggregateFunction(sum, UInt64),
  ft_channel        SimpleAggregateFunction(any, LowCardinality(String)),
  ft_utm_source     SimpleAggregateFunction(any, LowCardinality(String)),
  ft_utm_campaign   SimpleAggregateFunction(any, String),
  ft_campaign_id    SimpleAggregateFunction(any, String),
  device_type       SimpleAggregateFunction(anyLast, LowCardinality(String)),
  country           SimpleAggregateFunction(anyLast, LowCardinality(String)),
  max_step          SimpleAggregateFunction(max, UInt8),
  flow_completed    SimpleAggregateFunction(max, UInt8),
  revenue           SimpleAggregateFunction(sum, Float64)
)
ENGINE = AggregatingMergeTree
ORDER BY (project_id, anonymous_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS visitors_mv TO visitors AS
SELECT
  project_id,
  anonymous_id,
  max(user_id) AS user_id,
  min(ts) AS first_seen,
  max(ts) AS last_seen,
  uniqState(session_id) AS sessions,
  count() AS events,
  any(ft_channel) AS ft_channel,
  any(ft_utm_source) AS ft_utm_source,
  any(ft_utm_campaign) AS ft_utm_campaign,
  any(ft_campaign_id) AS ft_campaign_id,
  anyLast(device_type) AS device_type,
  anyLast(country) AS country,
  max(step) AS max_step,
  maxIf(1, event = 'onboarding_completed') AS flow_completed,
  sumIf(revenue, event IN ('purchase', '$revenue')) AS revenue
FROM events
GROUP BY project_id, anonymous_id;

-- anonymous_id -> person mapping written on identify(). Queries resolve
-- person_id = coalesce(identities.user_id, toString(anonymous_id)), so history from before
-- identify() is merged into the user without rewriting events.
CREATE TABLE IF NOT EXISTS identities
(
  project_id        LowCardinality(String),
  anonymous_id      UUID,
  user_id           String,
  updated_at        DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (project_id, anonymous_id);
