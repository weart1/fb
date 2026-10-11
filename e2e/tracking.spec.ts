/**
 * End-to-end: real browser → SDK → ingest → ClickHouse (materialized views included).
 * Requires `pnpm infra:up`, `pnpm db:migrate`, `pnpm --filter @weart/sdk build`, and ingest on :4318.
 */
import { expect, test } from '@playwright/test';
import { createClient } from '@clickhouse/client';

const IG_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; en_US)';

const ch = createClient({ url: 'http://localhost:8123', username: 'weart', password: 'weart', database: 'weart' });
const q = async <T>(query: string, params: Record<string, unknown>): Promise<T[]> =>
  (await ch.query({ query, query_params: params, format: 'JSONEachRow' })).json<T>();

test('ad click → onboarding → drop-off at email field is fully recorded', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: IG_UA, viewport: { width: 390, height: 744 }, extraHTTPHeaders: { 'cf-ipcountry': 'US' } });
  const page = await ctx.newPage();
  const campaign = `e2e_${Date.now()}`;
  await page.goto(
    `http://localhost:5173/onboarding-3/?utm_source=instagram&utm_medium=paid_social&utm_campaign=${campaign}&campaign_id=c1&adset_id=as1&ad_id=ad1&fbclid=IwAR_e2e`,
  );
  await page.click('#accept');
  await page.click('[data-wa="ob-start"]');
  await page.click('[data-wa="style-bold"]');
  await page.click('#next');
  await page.focus('[name=goal]');
  await page.selectOption('[name=goal]', 'portfolio');
  await page.click('#next');
  await page.fill('[name=first_name]', 'Jane');
  await page.fill('[name=email]', 'jane@not-an-email');
  await page.click('#next'); // validation error
  await page.click('#next'); // again
  await page.click('#next'); // rage
  const anon = await page.evaluate(() => (window as unknown as { weart: { anonymousId: string } }).weart.anonymousId);
  await page.close({ runBeforeUnload: true }); // pagehide → beacon
  await ctx.close();

  // ingest flushes to ClickHouse every second
  await expect
    .poll(async () => (await q<{ c: string }>('SELECT count() c FROM events WHERE utm_campaign = {c:String}', { c: campaign }))[0]?.c, {
      timeout: 15_000,
    })
    .not.toBe('0');
  await new Promise((r) => setTimeout(r, 2500));

  const events = await q<{ event: string; step: number; field_name: string; properties: string }>(
    'SELECT event, step, field_name, properties FROM events WHERE utm_campaign = {c:String} ORDER BY ts',
    { c: campaign },
  );
  const names = events.map((e) => e.event);
  for (const n of ['$pageview', '$consent', 'onboarding_started', 'onboarding_step_viewed', 'onboarding_step_completed', '$click', '$form_field_focus', '$form_field_blur', '$form_field_error', 'onboarding_step_error', '$rage_click', '$pageleave', 'onboarding_abandoned']) {
    expect(names, `missing ${n}`).toContain(n);
  }
  // no form values ever reach storage
  expect(JSON.stringify(events)).not.toContain('Jane');
  expect(JSON.stringify(events)).not.toContain('not-an-email');
  // whitelisted non-PII value captured
  expect(events.some((e) => e.event === '$form_field_blur' && e.properties.includes('"value":"portfolio"'))).toBe(true);
  const abandoned = events.find((e) => e.event === 'onboarding_abandoned')!;
  expect(abandoned.step).toBe(4);
  expect(abandoned.field_name).toBe('email');

  const [session] = await q<Record<string, string | number>>(
    `SELECT channel, ad_platform, campaign_id, adset_id, ad_id, in_app_browser, device_type, country, max(max_step) AS max_step,
            max(flow_completed) AS completed, sum(rage_clicks) AS rage, argMinMerge(entry_path) AS entry
     FROM sessions WHERE utm_campaign = {c:String} GROUP BY channel, ad_platform, campaign_id, adset_id, ad_id, in_app_browser, device_type, country`,
    { c: campaign },
  );
  expect(session).toMatchObject({
    channel: 'paid_social',
    ad_platform: 'meta',
    campaign_id: 'c1',
    adset_id: 'as1',
    ad_id: 'ad1',
    in_app_browser: 'instagram',
    device_type: 'mobile',
    country: 'US',
    max_step: 4,
    completed: 0,
    entry: '/onboarding-3/',
  });
  expect(Number(session!.rage)).toBeGreaterThanOrEqual(1);

  const steps = await q<{ step: number; entered: number; completed: number; last_field: string }>(
    `SELECT step, countIf(entered_at IS NOT NULL) AS entered, countIf(completed_at IS NOT NULL) AS completed, argMaxMerge(last_field) AS last_field
     FROM (SELECT session_id, step, min(entered_at) AS entered_at, min(completed_at) AS completed_at, argMaxMergeState(last_field) AS last_field
           FROM flow_steps WHERE flow_id = 'onboarding-3' AND anonymous_id = {a:UUID} GROUP BY session_id, step)
     GROUP BY step ORDER BY step`,
    { a: anon },
  );
  expect(steps.map((s) => [s.step, Number(s.entered), Number(s.completed)])).toEqual([
    [1, 1, 1],
    [2, 1, 1],
    [3, 1, 1],
    [4, 1, 0],
  ]);
  expect(steps[3]!.last_field).toBe('email');
});

test('declined consent sends nothing', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: IG_UA });
  const page = await ctx.newPage();
  const campaign = `e2e_denied_${Date.now()}`;
  const requests: string[] = [];
  page.on('request', (r) => r.url().includes('/v1/batch') && requests.push(r.url()));
  await page.goto(`http://localhost:5173/onboarding-3/?utm_source=tiktok&utm_campaign=${campaign}`);
  await page.click('#decline');
  await page.click('[data-wa="ob-start"]');
  await page.close({ runBeforeUnload: true });
  await ctx.close();
  await new Promise((r) => setTimeout(r, 2000));
  expect(requests).toHaveLength(0);
});
