import { ensureHashed, sha256 } from '../hash';
import type { ConversionJob, Destination } from '../job';

export interface TikTokCreds {
  pixel_code: string;
  access_token: string;
  test_event_code?: string;
}

export const TIKTOK_DEFAULT_EVENTS: Record<string, string> = {
  onboarding_completed: 'CompleteRegistration',
  sign_up: 'SubmitForm',
  purchase: 'CompletePayment',
};

/** TikTok Events API 1.3. event_id dedups with the TikTok Pixel. */
export const tiktok: Destination<TikTokCreds> = {
  build(job, platformEvent, creds) {
    const user: Record<string, unknown> = {
      external_id: sha256(job.user_id || job.anonymous_id),
      user_agent: job.user_agent,
    };
    if (job.click_id_type === 'ttclid' && job.click_id) user.ttclid = job.click_id;
    if (job.email_hash) user.email = ensureHashed(job.email_hash);
    if (job.phone_hash) user.phone = ensureHashed(job.phone_hash);
    if (job.client_ip) user.ip = job.client_ip;
    const properties: Record<string, unknown> = {};
    if (job.revenue) {
      properties.value = job.revenue;
      properties.currency = job.currency || 'USD';
    }
    if (job.order_id) properties.order_id = job.order_id;
    const body: Record<string, unknown> = {
      event_source: 'web',
      event_source_id: creds.pixel_code,
      data: [{ event: platformEvent, event_time: Math.floor(job.ts / 1000), event_id: job.event_id, user, page: { url: job.url }, properties }],
    };
    if (creds.test_event_code) body.test_event_code = creds.test_event_code;
    return {
      url: 'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      headers: { 'Content-Type': 'application/json', 'Access-Token': creds.access_token },
      body,
    };
  },
};
