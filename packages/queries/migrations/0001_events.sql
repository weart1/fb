-- Raw event log. One row per event. Everything else is derived from it.
-- Statements in migration files are separated by a semicolon at the end of a line.
CREATE TABLE IF NOT EXISTS events
(
  project_id        LowCardinality(String),
  event_id          UUID,
  event             LowCardinality(String),
  ts                DateTime64(3, 'UTC'),
  received_at       DateTime64(3, 'UTC'),
  anonymous_id      UUID,
  session_id        UUID,
  session_start     DateTime64(3, 'UTC'),
  user_id           String,

  url               String,
  path              String,
  host              LowCardinality(String),
  title             String,
  referrer          String,
  referrer_domain   LowCardinality(String),

  -- session attribution (last non-direct touch, 30 day lookback, resolved by the SDK)
  channel           LowCardinality(String),
  ad_platform       LowCardinality(String),
  utm_source        LowCardinality(String),
  utm_medium        LowCardinality(String),
  utm_campaign      String,
  utm_content       String,
  utm_term          String,
  campaign_id       String,
  adset_id          String,
  ad_id             String,
  creative_id       String,
  click_id_type     LowCardinality(String),
  click_id          String,
  landing_path      String,

  -- first-touch attribution of the visitor
  ft_channel        LowCardinality(String),
  ft_ad_platform    LowCardinality(String),
  ft_utm_source     LowCardinality(String),
  ft_utm_medium     LowCardinality(String),
  ft_utm_campaign   String,
  ft_campaign_id    String,
  ft_adset_id       String,
  ft_ad_id          String,
  ft_creative_id    String,
  ft_ts             DateTime64(3, 'UTC'),

  -- device / geo (server-side enrichment; raw IP is never stored)
  device_type       LowCardinality(String),
  browser           LowCardinality(String),
  browser_version   LowCardinality(String),
  os                LowCardinality(String),
  os_version        LowCardinality(String),
  in_app_browser    LowCardinality(String),
  screen_w          UInt16,
  screen_h          UInt16,
  viewport_w        UInt16,
  viewport_h        UInt16,
  language          LowCardinality(String),
  timezone          LowCardinality(String),
  country           LowCardinality(String),
  region            LowCardinality(String),
  city              String,

  -- flow context: the SDK attaches the current flow step to every event fired while a flow is open
  flow_id           LowCardinality(String),
  step              UInt8,
  step_name         LowCardinality(String),

  -- typed hot properties (common query paths avoid JSON parsing)
  duration_ms       UInt32,
  idle_ms           UInt32,
  value             Float64,
  element_selector  String,
  element_text      String,
  x                 UInt16,
  y                 UInt16,
  page_x            UInt32,
  page_y            UInt32,
  field_name        LowCardinality(String),
  error_message     String,
  revenue           Float64,
  currency          LowCardinality(String),
  order_id          String,
  experiments       Map(String, String),

  properties        String CODEC(ZSTD(3)),
  sdk_version       LowCardinality(String),
  has_replay        UInt8,

  INDEX idx_session session_id TYPE bloom_filter(0.01) GRANULARITY 2,
  INDEX idx_user user_id TYPE bloom_filter(0.01) GRANULARITY 2,
  INDEX idx_path path TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, toDate(ts), event, anonymous_id, event_id)
TTL toDateTime(ts) + INTERVAL 395 DAY
SETTINGS index_granularity = 8192;
