import type { SerializedEventRow } from '@weart/queries';
import type { Batch } from '@weart/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { MemoryDeduper } from '../src/dedup';
import { enrichBatch } from '../src/enrich';
import type { ConversionJob } from '../src/forwarding';
import { GeoResolver } from '../src/geo';
import { DEFAULT_REMOTE_CONFIG } from '../src/remote-config';
import { buildServer, type RowSink } from '../src/server';
import { parseUA } from '../src/ua';

const IPHONE_IG =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; en_US)';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const ANON = '0192d0a0-0000-7000-8000-000000000001';
const SESSION = '0192d0a0-0000-7000-8000-000000000002';

function batch(over: Partial<Batch> = {}, now = Date.now()): Batch {
  return {
    site: 'weartstudio',
    sdk: '0.1.0',
    sent_at: now,
    ctx: {
      anonymous_id: ANON,
      session_id: SESSION,
      session_start: now - 60_000,
      screen_w: 390,
      screen_h: 844,
      viewport_w: 390,
      viewport_h: 664,
      language: 'en-US',
      touch: {
        utm_source: 'Instagram',
        utm_medium: 'paid_social',
        utm_campaign: 'Spring Launch',
        campaign_id: '120',
        adset_id: '121',
        ad_id: '122',
        click_id_type: 'fbclid',
        click_id: 'IwAR',
        referrer: 'https://l.instagram.com/',
        landing_url: 'https://weartstudio.io/onboarding-3?utm_source=Instagram',
        ts: now - 60_000,
      },
    },
    events: [
      {
        id: '0192d0a0-0000-7000-8000-0000000000a1',
        name: 'onboarding_step_completed',
        ts: now - 1000,
        url: 'https://weartstudio.io/onboarding-3',
        props: { flow_id: 'onboarding-3', step: 2, step_name: 'style', duration_ms: 14200, choice: 'minimal' },
      },
    ],
    ...over,
  };
}

describe('enrichBatch', () => {
  it('lifts typed props, classifies attribution and corrects clock skew', () => {
    const now = Date.now();
    const b = batch({}, now);
    // client clock 1h behind
    const skewed: Batch = { ...b, sent_at: now - 3_600_000, events: b.events.map((e) => ({ ...e, ts: e.ts - 3_600_000 })) };
    const { rows } = enrichBatch(skewed, { projectId: 'weartstudio', receivedAt: now, ua: parseUA(IPHONE_IG), geo: { country: 'US', region: 'CA', city: 'LA' } });
    const r = rows[0]!;
    expect(Math.abs(r.ts - (now - 1000))).toBeLessThan(5);
    expect(r).toMatchObject({
      flow_id: 'onboarding-3',
      step: 2,
      step_name: 'style',
      duration_ms: 14200,
      channel: 'paid_social',
      ad_platform: 'meta',
      utm_source: 'instagram',
      campaign_id: '120',
      landing_path: '/onboarding-3',
      referrer_domain: 'l.instagram.com',
      device_type: 'mobile',
      in_app_browser: 'instagram',
      browser: 'Instagram in-app',
      country: 'US',
      path: '/onboarding-3',
    });
    expect(JSON.parse(r.properties)).toEqual({ choice: 'minimal' });
  });

  it('rejects events older than 7 days', () => {
    const now = Date.now();
    const b = batch({}, now);
    b.events[0]!.ts = now - 8 * 86400_000;
    const { rows, rejected } = enrichBatch(b, { projectId: 'p', receivedAt: now, ua: parseUA(CHROME), geo: { country: '', region: '', city: '' } });
    expect(rows).toHaveLength(0);
    expect(rejected).toBe(1);
  });
});

describe('parseUA', () => {
  it('desktop chrome', () => {
    expect(parseUA(CHROME)).toMatchObject({ device_type: 'desktop', browser: 'Chrome', os: 'Windows', in_app_browser: '' });
  });
});

describe('HTTP', () => {
  async function server() {
    const pushed: Record<string, unknown[]> = {};
    const jobs: ConversionJob[] = [];
    const sink: RowSink = {
      push: (t, rows) => (pushed[t] ??= []).push(...rows),
      accepting: true,
      size: 0,
    };
    const app = buildServer({
      cfg: loadConfig({ INGEST_SITE_IDS: 'weartstudio', INGEST_ALLOWED_ORIGINS: 'https://weartstudio.io' }),
      sink,
      dedup: new MemoryDeduper(),
      geo: await GeoResolver.create(''),
      blobs: { putJson: async () => 100 },
      conversions: { enqueue: async (j) => void jobs.push(...j) },
      remoteConfig: { get: async () => DEFAULT_REMOTE_CONFIG },
      sdkDir: '/nonexistent',
    });
    return { app, pushed, jobs };
  }

  it('accepts a text/plain batch, sets the visitor cookie, dedups retries', async () => {
    const { app, pushed } = await server();
    const body = JSON.stringify(batch());
    const headers = { 'content-type': 'text/plain', 'user-agent': IPHONE_IG, 'cf-ipcountry': 'DE', origin: 'https://weartstudio.io' };
    const r1 = await app.inject({ method: 'POST', url: '/v1/batch', headers, body });
    expect(r1.statusCode).toBe(202);
    expect(r1.headers['set-cookie']).toContain(`wa_id=${ANON}`);
    expect(r1.headers['access-control-allow-origin']).toBe('https://weartstudio.io');
    const r2 = await app.inject({ method: 'POST', url: '/v1/batch', headers, body });
    expect(r2.json()).toMatchObject({ accepted: 0 });
    const rows = pushed.events as SerializedEventRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.country).toBe('DE');
    expect(rows[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it('drops bots, rejects unknown sites and invalid payloads', async () => {
    const { app, pushed } = await server();
    const bot = await app.inject({ method: 'POST', url: '/v1/batch', headers: { 'content-type': 'text/plain', 'user-agent': 'facebookexternalhit/1.1' }, body: JSON.stringify(batch()) });
    expect(bot.statusCode).toBe(204);
    const unknown = await app.inject({ method: 'POST', url: '/v1/batch', headers: { 'content-type': 'text/plain', 'user-agent': CHROME }, body: JSON.stringify(batch({ site: 'evil' })) });
    expect(unknown.statusCode).toBe(400);
    const invalid = await app.inject({ method: 'POST', url: '/v1/batch', headers: { 'content-type': 'text/plain', 'user-agent': CHROME }, body: '{"site":1}' });
    expect(invalid.statusCode).toBe(400);
    const notJson = await app.inject({ method: 'POST', url: '/v1/batch', headers: { 'content-type': 'text/plain', 'user-agent': CHROME }, body: 'nope' });
    expect(notJson.statusCode).toBe(400);
    expect(pushed.events).toBeUndefined();
  });

  it('records identities and enqueues conversions for forwarding', async () => {
    const { app, pushed, jobs } = await server();
    const b = batch();
    b.ctx.user_id = 'user_42';
    b.events = [{ id: '0192d0a0-0000-7000-8000-0000000000b1', name: 'purchase', ts: Date.now(), url: 'https://weartstudio.io/onboarding-3', props: { revenue: 29.99, currency: 'usd', order_id: 'o_1', email_hash: 'abc' } }];
    await app.inject({ method: 'POST', url: '/v1/batch', headers: { 'content-type': 'text/plain', 'user-agent': CHROME }, body: JSON.stringify(b) });
    expect(pushed.identities).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ event: 'purchase', revenue: 29.99, currency: 'USD', click_id_type: 'fbclid', email_hash: 'abc' });
    expect(jobs[0]!.client_ip).toBeUndefined();
  });

  it('applies backpressure when the buffer is full', async () => {
    const { app } = await server();
    // rebuild with a full sink
    const full = buildServer({
      cfg: loadConfig({ INGEST_SITE_IDS: 'weartstudio' }),
      sink: { push: () => undefined, accepting: false, size: 1e9 },
      dedup: new MemoryDeduper(),
      geo: await GeoResolver.create(''),
      blobs: { putJson: async () => 0 },
      conversions: { enqueue: async () => undefined },
      remoteConfig: { get: async () => DEFAULT_REMOTE_CONFIG },
      sdkDir: '',
    });
    const r = await full.inject({ method: 'POST', url: '/v1/batch', headers: { 'content-type': 'text/plain', 'user-agent': CHROME }, body: JSON.stringify(batch()) });
    expect(r.statusCode).toBe(503);
    expect(r.headers['retry-after']).toBe('5');
    await app.close();
  });

  it('serves remote config', async () => {
    const { app } = await server();
    const r = await app.inject({ method: 'GET', url: '/v1/config?site=weartstudio' });
    expect(r.json()).toMatchObject({ replay_sample_rate: 0.25 });
  });
});
