import { ensureHashed } from '../hash';
import type { ConversionJob, Destination } from '../job';

export interface GoogleAdsCreds {
  customer_id: string;
  developer_token: string;
  /** OAuth access token, refreshed by the worker from the refresh token */
  access_token: string;
  login_customer_id?: string;
  /** conversion action id per platform event, e.g. { purchase: "123", onboarding_completed: "456" } */
  conversion_actions: Record<string, string>;
}

export const GOOGLE_DEFAULT_EVENTS: Record<string, string> = {
  onboarding_completed: 'onboarding_completed',
  purchase: 'purchase',
};

/** "2026-10-11 12:34:56+00:00" */
const googleTime = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;

/**
 * Google Ads click conversion upload (+ enhanced conversions via hashed email).
 * Requires a Google click id (gclid / gbraid / wbraid) or a hashed email.
 */
export const google: Destination<GoogleAdsCreds> = {
  build(job, platformEvent, creds) {
    const action = creds.conversion_actions[platformEvent];
    const hasClick = ['gclid', 'gbraid', 'wbraid'].includes(job.click_id_type) && !!job.click_id;
    if (!action || (!hasClick && !job.email_hash)) return null;
    const customer = creds.customer_id.replace(/-/g, '');
    const conversion: Record<string, unknown> = {
      conversionAction: `customers/${customer}/conversionActions/${action}`,
      conversionDateTime: googleTime(job.ts),
      orderId: job.order_id || job.event_id,
    };
    if (hasClick) conversion[job.click_id_type] = job.click_id;
    if (job.revenue) {
      conversion.conversionValue = job.revenue;
      conversion.currencyCode = job.currency || 'USD';
    }
    if (job.email_hash) conversion.userIdentifiers = [{ hashedEmail: ensureHashed(job.email_hash) }];
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.access_token}`,
      'developer-token': creds.developer_token,
    };
    if (creds.login_customer_id) headers['login-customer-id'] = creds.login_customer_id.replace(/-/g, '');
    return {
      url: `https://googleads.googleapis.com/v18/customers/${customer}:uploadClickConversions`,
      headers,
      body: { conversions: [conversion], partialFailure: true },
    };
  },
};
