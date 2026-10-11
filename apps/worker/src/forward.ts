import { google, GOOGLE_DEFAULT_EVENTS, type GoogleAdsCreds } from './destinations/google';
import { meta, META_DEFAULT_EVENTS, type MetaCreds } from './destinations/meta';
import { tiktok, TIKTOK_DEFAULT_EVENTS, type TikTokCreds } from './destinations/tiktok';
import type { ConversionJob, Destination, SendResult } from './job';

export type DestinationType = 'META_CAPI' | 'GOOGLE_ADS' | 'TIKTOK_EVENTS';

export interface ResolvedDestination {
  id: string;
  type: DestinationType;
  enabled: boolean;
  dryRun: boolean;
  /** decrypted credentials; null when not configured (forces dry-run) */
  creds: MetaCreds | GoogleAdsCreds | TikTokCreds | null;
  /** our event → platform event; falls back to platform defaults */
  eventMap: Record<string, string>;
}

export interface ForwardDeps {
  destinations(projectId: string): Promise<ResolvedDestination[]>;
  record(destinationId: string, job: ConversionJob, platformEvent: string, result: SendResult): Promise<void>;
  http(url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  log(msg: string, meta?: Record<string, unknown>): void;
}

const IMPL: Record<DestinationType, { dest: Destination<never>; defaults: Record<string, string> }> = {
  META_CAPI: { dest: meta as Destination<never>, defaults: META_DEFAULT_EVENTS },
  GOOGLE_ADS: { dest: google as Destination<never>, defaults: GOOGLE_DEFAULT_EVENTS },
  TIKTOK_EVENTS: { dest: tiktok as Destination<never>, defaults: TIKTOK_DEFAULT_EVENTS },
};

/** Placeholder credentials so dry-run payloads are fully formed (and visible in logs) before setup. */
const DRY_RUN_CREDS: Record<DestinationType, unknown> = {
  META_CAPI: { pixel_id: 'PIXEL_ID', access_token: 'REDACTED' },
  GOOGLE_ADS: { customer_id: '000-000-0000', developer_token: 'REDACTED', access_token: 'REDACTED', conversion_actions: { onboarding_completed: '0', purchase: '0' } },
  TIKTOK_EVENTS: { pixel_code: 'PIXEL_CODE', access_token: 'REDACTED' },
};

/**
 * Forward one conversion to every enabled destination of its project.
 * Throws if any live send failed, so BullMQ retries (destinations already sent are skipped via the log).
 */
export async function forwardConversion(job: ConversionJob, deps: ForwardDeps, alreadySent: (destinationId: string) => Promise<boolean>): Promise<SendResult[]> {
  const results: SendResult[] = [];
  const failures: string[] = [];
  for (const d of await deps.destinations(job.project_id)) {
    if (!d.enabled) continue;
    const impl = IMPL[d.type];
    const platformEvent = d.eventMap[job.event] ?? impl.defaults[job.event];
    if (!platformEvent) continue;
    if (await alreadySent(d.id)) continue;

    const dry = d.dryRun || !d.creds;
    const req = impl.dest.build(job, platformEvent, (d.creds ?? DRY_RUN_CREDS[d.type]) as never);
    let result: SendResult;
    if (!req) {
      result = { status: 'skipped', response: 'event cannot be matched on this platform (no click id / identifiers)' };
    } else if (dry) {
      deps.log(`[dry-run] ${d.type} ${platformEvent}`, { url: req.url.replace(/access_token=[^&]+/, 'access_token=REDACTED'), body: req.body });
      result = { status: 'dry_run', response: JSON.stringify(req.body).slice(0, 4000) };
    } else {
      try {
        const res = await deps.http(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
        const text = (await res.text()).slice(0, 4000);
        result = res.ok ? { status: 'sent', response: text } : { status: 'failed', response: `${res.status} ${text}` };
      } catch (err) {
        result = { status: 'failed', response: err instanceof Error ? err.message : String(err) };
      }
      if (result.status === 'failed') failures.push(`${d.type}: ${result.response ?? ''}`);
    }
    await deps.record(d.id, job, platformEvent, result);
    results.push(result);
  }
  if (failures.length) throw new Error(`conversion forwarding failed: ${failures.join('; ')}`);
  return results;
}
