import { describe, expect, it } from 'vitest';
import { google } from '../src/destinations/google';
import { meta } from '../src/destinations/meta';
import { tiktok } from '../src/destinations/tiktok';
import { forwardConversion, type ForwardDeps, type ResolvedDestination } from '../src/forward';
import { sha256 } from '../src/hash';
import type { ConversionJob, SendResult } from '../src/job';

const job: ConversionJob = {
  project_id: 'weartstudio',
  event_id: '0192d0a0-0000-7000-8000-0000000000b1',
  event: 'purchase',
  ts: Date.UTC(2026, 9, 11, 12, 0, 0),
  url: 'https://weartstudio.io/onboarding-3',
  anonymous_id: '0192d0a0-0000-7000-8000-000000000001',
  user_id: 'user_42',
  click_id_type: 'fbclid',
  click_id: 'IwAR123',
  utm_source: 'facebook',
  campaign_id: '1',
  adset_id: '2',
  ad_id: '3',
  revenue: 29.99,
  currency: 'USD',
  order_id: 'o_1',
  email_hash: sha256('Jane@Example.com'),
  phone_hash: '',
  user_agent: 'UA',
  country: 'US',
};

describe('payload builders', () => {
  it('meta CAPI: dedup event_id, fbc, hashed identifiers, value', () => {
    const req = meta.build(job, 'Purchase', { pixel_id: '999', access_token: 'tok', test_event_code: 'TEST1' })!;
    expect(req.url).toBe('https://graph.facebook.com/v21.0/999/events?access_token=tok');
    const body = req.body as { data: Array<Record<string, unknown>>; test_event_code: string };
    expect(body.test_event_code).toBe('TEST1');
    expect(body.data[0]).toMatchObject({
      event_name: 'Purchase',
      event_id: job.event_id,
      event_time: 1791720000,
      action_source: 'website',
      user_data: { em: [sha256('jane@example.com')], fbc: `fb.1.${job.ts}.IwAR123`, external_id: [sha256('user_42')], country: [sha256('us')] },
      custom_data: { value: 29.99, currency: 'USD', order_id: 'o_1' },
    });
    expect(JSON.stringify(body)).not.toContain('client_ip_address');
  });

  it('google ads: needs a google click id or hashed email', () => {
    const creds = { customer_id: '123-456-7890', developer_token: 'd', access_token: 'a', conversion_actions: { purchase: '77' } };
    const withGclid = google.build({ ...job, click_id_type: 'gclid', click_id: 'Cj0' }, 'purchase', creds)!;
    expect(withGclid.url).toContain('/customers/1234567890:uploadClickConversions');
    expect((withGclid.body as { conversions: Array<Record<string, unknown>> }).conversions[0]).toMatchObject({
      gclid: 'Cj0',
      conversionAction: 'customers/1234567890/conversionActions/77',
      conversionDateTime: '2026-10-11 12:00:00+00:00',
      conversionValue: 29.99,
    });
    expect(google.build({ ...job, email_hash: '' }, 'purchase', creds)).toBeNull();
    expect(google.build(job, 'unknown_action', creds)).toBeNull();
  });

  it('tiktok events api', () => {
    const req = tiktok.build({ ...job, click_id_type: 'ttclid', click_id: 'tt1' }, 'CompletePayment', { pixel_code: 'PX', access_token: 't' })!;
    expect(req.headers['Access-Token']).toBe('t');
    expect((req.body as { data: Array<Record<string, unknown>> }).data[0]).toMatchObject({
      event: 'CompletePayment',
      event_id: job.event_id,
      user: { ttclid: 'tt1', email: sha256('jane@example.com') },
      properties: { value: 29.99, currency: 'USD' },
    });
  });
});

describe('forwardConversion', () => {
  const dest = (over: Partial<ResolvedDestination>): ResolvedDestination => ({
    id: 'd1',
    type: 'META_CAPI',
    enabled: true,
    dryRun: false,
    creds: { pixel_id: 'p', access_token: 't' },
    eventMap: {},
    ...over,
  });

  function deps(list: ResolvedDestination[], status = 200) {
    const records: Array<[string, SendResult]> = [];
    const calls: string[] = [];
    const d: ForwardDeps = {
      destinations: async () => list,
      record: async (id, _j, _e, r) => void records.push([id, r]),
      http: async (url) => {
        calls.push(url);
        return { ok: status < 400, status, text: async () => '{"events_received":1}' };
      },
      log: () => undefined,
    };
    return { d, records, calls };
  }

  it('sends to enabled destinations, dry-runs without credentials, skips disabled', async () => {
    const { d, records, calls } = deps([
      dest({ id: 'live' }),
      dest({ id: 'dry', type: 'TIKTOK_EVENTS', creds: null }),
      dest({ id: 'off', enabled: false }),
    ]);
    await forwardConversion(job, d, async () => false);
    expect(calls).toHaveLength(1);
    expect(records.map(([id, r]) => [id, r.status])).toEqual([
      ['live', 'sent'],
      ['dry', 'dry_run'],
    ]);
  });

  it('throws on platform errors so the queue retries, and does not resend completed destinations', async () => {
    const { d } = deps([dest({ id: 'live' })], 500);
    await expect(forwardConversion(job, d, async () => false)).rejects.toThrow(/META_CAPI/);
    const ok = deps([dest({ id: 'live' })]);
    await forwardConversion(job, ok.d, async () => true);
    expect(ok.calls).toHaveLength(0);
  });

  it('ignores events without a mapping', async () => {
    const { d, records } = deps([dest({})]);
    await forwardConversion({ ...job, event: 'onboarding_started' }, d, async () => false);
    expect(records).toHaveLength(0);
  });
});
