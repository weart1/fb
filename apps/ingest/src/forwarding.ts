import type { EventRow } from '@weart/queries';
import type { Queue } from 'bullmq';

/** Events forwarded server-side to ad platforms (Meta CAPI, Google Ads, TikTok Events API). */
export const FORWARDED_EVENTS = new Set(['onboarding_completed', 'sign_up', 'purchase', 'onboarding_started']);

export const CONVERSIONS_QUEUE = 'conversions';

/** Job payload consumed by apps/worker. Kept minimal; jobs are deleted after processing. */
export interface ConversionJob {
  project_id: string;
  event_id: string;
  event: string;
  ts: number;
  url: string;
  anonymous_id: string;
  user_id: string;
  click_id_type: string;
  click_id: string;
  utm_source: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  revenue: number;
  currency: string;
  order_id: string;
  email_hash: string;
  phone_hash: string;
  user_agent: string;
  /** only when FORWARD_CLIENT_IP=true */
  client_ip?: string;
  country: string;
}

export interface ConversionSink {
  enqueue(jobs: ConversionJob[]): Promise<void>;
}

export class BullConversionSink implements ConversionSink {
  constructor(private readonly queue: Queue) {}
  async enqueue(jobs: ConversionJob[]): Promise<void> {
    if (!jobs.length) return;
    await this.queue.addBulk(
      jobs.map((data) => ({
        name: data.event,
        data,
        opts: {
          jobId: `${data.project_id}:${data.event_id}`, // idempotent
          attempts: 8,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { age: 86400 },
        },
      })),
    );
  }
}

export function conversionJobs(rows: EventRow[], userAgent: string, clientIp: string | undefined): ConversionJob[] {
  const jobs: ConversionJob[] = [];
  for (const r of rows) {
    if (!FORWARDED_EVENTS.has(r.event)) continue;
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(r.properties) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    const job: ConversionJob = {
      project_id: r.project_id,
      event_id: r.event_id,
      event: r.event,
      ts: r.ts,
      url: r.url,
      anonymous_id: r.anonymous_id,
      user_id: r.user_id,
      click_id_type: r.click_id_type,
      click_id: r.click_id,
      utm_source: r.utm_source,
      campaign_id: r.campaign_id,
      adset_id: r.adset_id,
      ad_id: r.ad_id,
      revenue: r.revenue,
      currency: r.currency,
      order_id: r.order_id,
      email_hash: typeof props.email_hash === 'string' ? props.email_hash : '',
      phone_hash: typeof props.phone_hash === 'string' ? props.phone_hash : '',
      user_agent: userAgent,
      country: r.country,
    };
    if (clientIp) job.client_ip = clientIp;
    jobs.push(job);
  }
  return jobs;
}
