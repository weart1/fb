import { emptyEventRow, type EventRow } from '@weart/queries';
import { adPlatform, classifyChannel, domainOf, type Batch, type PropValue, type Touch } from '@weart/shared';
import type { Geo } from './geo';
import type { ParsedUA } from './ua';

/** Events older than this (client clock, after skew correction) are rejected. */
export const MAX_EVENT_AGE_MS = 7 * 86400_000;

/** props that are lifted into typed columns; everything else stays in `properties` JSON */
const LIFTED = new Set([
  'flow_id', 'step', 'step_name', 'duration_ms', 'idle_ms', 'selector', 'text', 'x', 'y', 'page_x', 'page_y',
  'field', 'last_field', 'error', 'revenue', 'currency', 'order_id', 'pv_id',
]);

export interface RequestMeta {
  projectId: string;
  receivedAt: number;
  ua: ParsedUA;
  geo: Geo;
}

const num = (v: PropValue | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : 0);
const str = (v: PropValue | undefined, max = 256): string => (v === undefined || v === null ? '' : String(v).slice(0, max));
const clampU = (n: number, max: number): number => Math.max(0, Math.min(max, Math.round(n)));

function urlParts(u: string): { path: string; host: string } {
  try {
    const p = new URL(u);
    return { path: p.pathname || '/', host: p.hostname };
  } catch {
    return { path: '', host: '' };
  }
}

interface TouchCols {
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
  referrer_domain: string;
  landing_path: string;
}

export function touchColumns(t: Touch | undefined): TouchCols {
  const referrer_domain = domainOf(t?.referrer);
  return {
    channel: classifyChannel({ utm_source: t?.utm_source, utm_medium: t?.utm_medium, click_id_type: t?.click_id_type, referrer_domain }),
    ad_platform: adPlatform(t?.utm_source, t?.click_id_type),
    utm_source: (t?.utm_source ?? '').toLowerCase(),
    utm_medium: (t?.utm_medium ?? '').toLowerCase(),
    utm_campaign: t?.utm_campaign ?? '',
    utm_content: t?.utm_content ?? '',
    utm_term: t?.utm_term ?? '',
    campaign_id: t?.campaign_id ?? '',
    adset_id: t?.adset_id ?? '',
    ad_id: t?.ad_id ?? '',
    creative_id: t?.creative_id ?? '',
    click_id_type: t?.click_id_type ?? '',
    click_id: t?.click_id ?? '',
    referrer_domain,
    landing_path: t?.landing_url ? urlParts(t.landing_url).path : '',
  };
}

export interface EnrichResult {
  rows: EventRow[];
  rejected: number;
}

/**
 * Turn a validated SDK batch into ClickHouse rows: clock-skew correction, attribution
 * (channel/platform classification), UA + geo enrichment, typed property lifting.
 */
export function enrichBatch(batch: Batch, meta: RequestMeta): EnrichResult {
  const { ctx } = batch;
  // Client clocks are often wrong (especially on mobile). Shift all client timestamps by the
  // difference between server receive time and client send time.
  const skew = meta.receivedAt - batch.sent_at;
  const fix = (t: number): number => Math.min(t + skew, meta.receivedAt);

  const session = touchColumns(ctx.touch);
  const ft = touchColumns(ctx.first_touch);
  const sessionStart = fix(ctx.session_start);
  const rows: EventRow[] = [];
  let rejected = 0;

  for (const e of batch.events) {
    const ts = fix(e.ts);
    if (meta.receivedAt - ts > MAX_EVENT_AGE_MS) {
      rejected++;
      continue;
    }
    const p = e.props ?? {};
    const { path, host } = urlParts(e.url);
    const rest: Record<string, PropValue> = {};
    for (const [k, v] of Object.entries(p)) if (!LIFTED.has(k)) rest[k] = v;
    if (p.pv_id !== undefined) rest.pv_id = p.pv_id;

    const row: EventRow = {
      ...emptyEventRow(),
      project_id: meta.projectId,
      event_id: e.id,
      event: e.name,
      ts,
      received_at: meta.receivedAt,
      anonymous_id: ctx.anonymous_id,
      session_id: ctx.session_id,
      session_start: Math.min(sessionStart, ts),
      user_id: ctx.user_id ?? '',
      url: e.url,
      path,
      host,
      title: e.title ?? '',
      referrer: e.referrer ?? '',
      ...session,
      ft_channel: ft.channel,
      ft_ad_platform: ft.ad_platform,
      ft_utm_source: ft.utm_source,
      ft_utm_medium: ft.utm_medium,
      ft_utm_campaign: ft.utm_campaign,
      ft_campaign_id: ft.campaign_id,
      ft_adset_id: ft.adset_id,
      ft_ad_id: ft.ad_id,
      ft_creative_id: ft.creative_id,
      ft_ts: ctx.first_touch ? fix(ctx.first_touch.ts) : sessionStart,
      ...meta.ua,
      screen_w: ctx.screen_w,
      screen_h: ctx.screen_h,
      viewport_w: ctx.viewport_w,
      viewport_h: ctx.viewport_h,
      language: ctx.language,
      timezone: ctx.timezone ?? '',
      ...meta.geo,
      flow_id: str(p.flow_id, 64),
      step: clampU(num(p.step), 255),
      step_name: str(p.step_name, 64),
      duration_ms: clampU(num(p.duration_ms), 4_294_967_295),
      idle_ms: clampU(num(p.idle_ms), 4_294_967_295),
      value: valueOf(e.name, p),
      element_selector: str(p.selector, 512),
      element_text: str(p.text, 64),
      x: clampU(num(p.x), 65535),
      y: clampU(num(p.y), 65535),
      page_x: clampU(num(p.page_x), 4_294_967_295),
      page_y: clampU(num(p.page_y), 4_294_967_295),
      field_name: str(p.field ?? p.last_field, 64),
      error_message: str(p.error, 512),
      revenue: num(p.revenue),
      currency: str(p.currency, 3).toUpperCase(),
      order_id: str(p.order_id, 128),
      experiments: ctx.experiments ?? {},
      properties: JSON.stringify(rest),
      sdk_version: batch.sdk,
      has_replay: ctx.replay ? 1 : 0,
    };
    rows.push(row);
  }
  return { rows, rejected };
}

/** Event-specific numeric value: web vital value, scroll depth, or form hesitation. */
function valueOf(name: string, p: Record<string, PropValue>): number {
  switch (name) {
    case '$web_vital':
      return num(p.value);
    case '$scroll_depth':
      return num(p.depth);
    case '$form_field_blur':
      return num(p.hesitation_ms);
    case '$pageleave':
      return num(p.scroll_max);
    default:
      return num(p.value);
  }
}
