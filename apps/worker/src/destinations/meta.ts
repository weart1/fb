import { ensureHashed, sha256 } from '../hash';
import type { ConversionJob, Destination } from '../job';

export interface MetaCreds {
  pixel_id: string;
  access_token: string;
  test_event_code?: string;
}

export const META_DEFAULT_EVENTS: Record<string, string> = {
  onboarding_completed: 'CompleteRegistration',
  sign_up: 'Lead',
  purchase: 'Purchase',
};

/** Meta Conversions API. event_id matches the browser event id, so Pixel + CAPI events deduplicate. */
export const meta: Destination<MetaCreds> = {
  build(job, platformEvent, creds) {
    const user_data: Record<string, unknown> = {
      external_id: [sha256(job.user_id || job.anonymous_id)],
      client_user_agent: job.user_agent,
    };
    if (job.email_hash) user_data.em = [ensureHashed(job.email_hash)];
    if (job.phone_hash) user_data.ph = [ensureHashed(job.phone_hash)];
    if (job.country) user_data.country = [sha256(job.country)];
    if (job.click_id_type === 'fbclid' && job.click_id) user_data.fbc = `fb.1.${job.ts}.${job.click_id}`;
    if (job.client_ip) user_data.client_ip_address = job.client_ip;
    const custom_data: Record<string, unknown> = {};
    if (job.revenue) {
      custom_data.value = job.revenue;
      custom_data.currency = job.currency || 'USD';
    }
    if (job.order_id) custom_data.order_id = job.order_id;
    const body: Record<string, unknown> = {
      data: [
        {
          event_name: platformEvent,
          event_time: Math.floor(job.ts / 1000),
          event_id: job.event_id,
          action_source: 'website',
          event_source_url: job.url,
          user_data,
          custom_data,
        },
      ],
    };
    if (creds.test_event_code) body.test_event_code = creds.test_event_code;
    return {
      url: `https://graph.facebook.com/v21.0/${encodeURIComponent(creds.pixel_id)}/events?access_token=${encodeURIComponent(creds.access_token)}`,
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  },
};
