/** Row shape of the ClickHouse `events` table, as written by ingest and the seed script. */
export interface EventRow {
  project_id: string;
  event_id: string;
  event: string;
  /** 'YYYY-MM-DD HH:MM:SS.mmm' UTC or ms epoch */
  ts: number;
  received_at: number;
  anonymous_id: string;
  session_id: string;
  session_start: number;
  user_id: string;

  url: string;
  path: string;
  host: string;
  title: string;
  referrer: string;
  referrer_domain: string;

  channel: string;
  ad_platform: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  creative_id: string;
  click_id_type: string;
  click_id: string;
  landing_path: string;

  ft_channel: string;
  ft_ad_platform: string;
  ft_utm_source: string;
  ft_utm_medium: string;
  ft_utm_campaign: string;
  ft_campaign_id: string;
  ft_adset_id: string;
  ft_ad_id: string;
  ft_creative_id: string;
  ft_ts: number;

  device_type: string;
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  in_app_browser: string;
  screen_w: number;
  screen_h: number;
  viewport_w: number;
  viewport_h: number;
  language: string;
  timezone: string;
  country: string;
  region: string;
  city: string;

  flow_id: string;
  step: number;
  step_name: string;

  duration_ms: number;
  idle_ms: number;
  value: number;
  element_selector: string;
  element_text: string;
  x: number;
  y: number;
  page_x: number;
  page_y: number;
  field_name: string;
  error_message: string;
  revenue: number;
  currency: string;
  order_id: string;
  experiments: Record<string, string>;

  properties: string;
  sdk_version: string;
  has_replay: number;
}

export interface IdentityRow {
  project_id: string;
  anonymous_id: string;
  user_id: string;
  updated_at: number;
}

export interface ReplayChunkRow {
  project_id: string;
  session_id: string;
  seq: number;
  anonymous_id: string;
  first_ts: number;
  last_ts: number;
  events: number;
  bytes: number;
  object_key: string;
  received_at: number;
}

export interface PageSnapshotRow {
  project_id: string;
  path: string;
  step_key: string;
  device_type: string;
  viewport_w: number;
  doc_h: number;
  object_key: string;
  captured_at: number;
}

export interface IngestStatsRow {
  project_id: string;
  minute: number;
  accepted: number;
  dropped_bot: number;
  dropped_duplicate: number;
  dropped_invalid: number;
  dropped_consent: number;
}

/** Empty row with all defaults, so producers only set what they know. */
export function emptyEventRow(): EventRow {
  return {
    project_id: '', event_id: '', event: '', ts: 0, received_at: 0, anonymous_id: '', session_id: '', session_start: 0, user_id: '',
    url: '', path: '', host: '', title: '', referrer: '', referrer_domain: '',
    channel: 'direct', ad_platform: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
    campaign_id: '', adset_id: '', ad_id: '', creative_id: '', click_id_type: '', click_id: '', landing_path: '',
    ft_channel: 'direct', ft_ad_platform: '', ft_utm_source: '', ft_utm_medium: '', ft_utm_campaign: '', ft_campaign_id: '',
    ft_adset_id: '', ft_ad_id: '', ft_creative_id: '', ft_ts: 0,
    device_type: '', browser: '', browser_version: '', os: '', os_version: '', in_app_browser: '',
    screen_w: 0, screen_h: 0, viewport_w: 0, viewport_h: 0, language: '', timezone: '', country: '', region: '', city: '',
    flow_id: '', step: 0, step_name: '',
    duration_ms: 0, idle_ms: 0, value: 0, element_selector: '', element_text: '', x: 0, y: 0, page_x: 0, page_y: 0,
    field_name: '', error_message: '', revenue: 0, currency: '', order_id: '', experiments: {},
    properties: '{}', sdk_version: '', has_replay: 0,
  };
}

/** ms epoch → ClickHouse DateTime64(3) literal in UTC ('YYYY-MM-DD HH:MM:SS.mmm'). */
export function chTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

const EVENT_TIME_FIELDS = ['ts', 'received_at', 'session_start', 'ft_ts'] as const;

export type SerializedEventRow = Omit<EventRow, (typeof EVENT_TIME_FIELDS)[number]> & Record<(typeof EVENT_TIME_FIELDS)[number], string>;

export function serializeEventRow(r: EventRow): SerializedEventRow {
  return { ...r, ts: chTime(r.ts), received_at: chTime(r.received_at), session_start: chTime(r.session_start), ft_ts: chTime(r.ft_ts) };
}
