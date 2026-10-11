import { z } from 'zod';
import { CLICK_ID_PARAMS } from './events';

/**
 * Wire format between the SDK and the ingest service.
 * A batch always belongs to exactly one session: the SDK flushes before rotating a session.
 */

export const LIMITS = {
  maxEventsPerBatch: 200,
  maxPropKeys: 64,
  maxPropKeyLength: 64,
  maxStringLength: 1024,
  maxUrlLength: 2048,
  maxBatchBytes: 512 * 1024,
} as const;

const uuid = z.string().uuid();
const shortStr = (max = 256) => z.string().max(max);
const url = z.string().max(LIMITS.maxUrlLength);

export const PropValue = z.union([z.string().max(LIMITS.maxStringLength), z.number().finite(), z.boolean(), z.null()]);
export type PropValue = z.infer<typeof PropValue>;

export const Props = z
  .record(z.string().min(1).max(LIMITS.maxPropKeyLength), PropValue)
  .refine((o) => Object.keys(o).length <= LIMITS.maxPropKeys, { message: `max ${LIMITS.maxPropKeys} properties` });
export type Props = z.infer<typeof Props>;

export const Touch = z.object({
  utm_source: shortStr().optional(),
  utm_medium: shortStr().optional(),
  utm_campaign: shortStr().optional(),
  utm_content: shortStr().optional(),
  utm_term: shortStr().optional(),
  campaign_id: shortStr(64).optional(),
  adset_id: shortStr(64).optional(),
  ad_id: shortStr(64).optional(),
  creative_id: shortStr(64).optional(),
  click_id_type: z.enum(CLICK_ID_PARAMS).optional(),
  click_id: shortStr(512).optional(),
  referrer: url.optional(),
  landing_url: url.optional(),
  /** ms epoch when this touch happened */
  ts: z.number().int().nonnegative(),
});
export type Touch = z.infer<typeof Touch>;

export const WireEvent = z.object({
  /** client-generated UUID, used for dedup */
  id: uuid,
  name: z.string().min(1).max(128),
  /** client clock, ms epoch */
  ts: z.number().int().nonnegative(),
  url: url,
  title: shortStr(512).optional(),
  referrer: url.optional(),
  props: Props.optional(),
});
export type WireEvent = z.infer<typeof WireEvent>;

export const BatchContext = z.object({
  anonymous_id: uuid,
  session_id: uuid,
  /** ms epoch when the session started (sessions are bucketed by their start date) */
  session_start: z.number().int().nonnegative(),
  user_id: shortStr(128).optional(),
  screen_w: z.number().int().min(0).max(20000),
  screen_h: z.number().int().min(0).max(20000),
  viewport_w: z.number().int().min(0).max(20000),
  viewport_h: z.number().int().min(0).max(20000),
  language: shortStr(35),
  timezone: shortStr(64).optional(),
  /** session (last-touch) attribution */
  touch: Touch.optional(),
  /** first-touch attribution for this visitor */
  first_touch: Touch.optional(),
  replay: z.boolean().optional(),
  /** active experiment assignments: key -> variant */
  experiments: z.record(shortStr(64), shortStr(64)).optional(),
});
export type BatchContext = z.infer<typeof BatchContext>;

export const Batch = z.object({
  site: shortStr(64),
  sdk: shortStr(32),
  sent_at: z.number().int().nonnegative(),
  ctx: BatchContext,
  events: z.array(WireEvent).min(1).max(LIMITS.maxEventsPerBatch),
});
export type Batch = z.infer<typeof Batch>;

/** Replay chunk upload (rrweb events, already JSON). Stored in object storage. */
export const ReplayChunk = z.object({
  site: shortStr(64),
  anonymous_id: uuid,
  session_id: uuid,
  seq: z.number().int().nonnegative(),
  first_ts: z.number().int().nonnegative(),
  last_ts: z.number().int().nonnegative(),
  /** rrweb events array; validated loosely, it is opaque to us */
  events: z.array(z.unknown()).min(1).max(5000),
});
export type ReplayChunk = z.infer<typeof ReplayChunk>;

/** Page snapshot for heatmaps (rrweb full snapshot of the page). */
export const PageSnapshot = z.object({
  site: shortStr(64),
  path: url,
  /** flow step if the page is a flow step, so heatmaps can be split per onboarding step */
  step_key: shortStr(128).optional(),
  viewport_w: z.number().int().min(0).max(20000),
  doc_h: z.number().int().min(0).max(200000),
  snapshot: z.unknown(),
});
export type PageSnapshot = z.infer<typeof PageSnapshot>;

/** Remote config fetched by the SDK (experiments, capture settings). */
export const RemoteConfig = z.object({
  experiments: z.array(
    z.object({
      key: z.string(),
      variants: z.array(z.object({ key: z.string(), weight: z.number().min(0) })).min(1),
      /** share of traffic in the experiment, 0..1 */
      traffic: z.number().min(0).max(1),
    }),
  ),
  replay_sample_rate: z.number().min(0).max(1),
  snapshot_sample_rate: z.number().min(0).max(1),
  capture_fields: z.array(z.string()),
});
export type RemoteConfig = z.infer<typeof RemoteConfig>;
