import { expect, test } from '@playwright/test';
import { createClient } from '@clickhouse/client';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const ch = createClient({ url: 'http://localhost:8123', username: 'weart', password: 'weart', database: 'weart' });

test('session replay chunks are uploaded to object storage and indexed', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/onboarding-3/?wa_replay=1&utm_source=google&utm_medium=cpc&gclid=e2e');
  await page.click('#accept');
  await page.click('[data-wa="ob-start"]');
  await page.click('[data-wa="style-retro"]');
  await page.mouse.move(100, 100);
  await page.mouse.move(200, 300);
  const sid = await page.evaluate(() => (window as unknown as { weart: { sessionId: string } }).weart.sessionId);
  await page.close({ runBeforeUnload: true });
  await ctx.close();
  expect(errors).toEqual([]);
  await expect
    .poll(
      async () => {
        const r = await ch.query({ query: 'SELECT sum(events) AS n FROM replay_chunks WHERE session_id = {s:UUID}', query_params: { s: sid }, format: 'JSONEachRow' });
        return Number((await r.json<{ n: string }>())[0]?.n ?? 0);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(2);
});
