/**
 * Full onboarding completion → purchase → ingest enqueues conversions → worker forwards them
 * (dry-run with seeded destinations) and logs the result in Postgres.
 * Requires the seed (Postgres project + destinations) and the worker running.
 */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const psql = (sql: string): string =>
  execFileSync('psql', ['-h', 'localhost', '-U', 'weart', '-d', 'weart', '-tAc', sql], { env: { ...process.env, PGPASSWORD: 'weart' } }).toString().trim();

test('completed onboarding is forwarded to Meta / Google / TikTok (dry-run)', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/onboarding-3/?utm_source=google&utm_medium=cpc&utm_campaign=e2e_conv&gclid=Cj0e2e');
  await page.click('#accept');
  await page.click('[data-wa="ob-start"]');
  await page.click('[data-wa="style-minimal"]');
  await page.click('#next');
  await page.click('#next');
  await page.fill('[name=email]', 'buyer@example.com');
  await page.click('#next');
  await page.click('#next');
  await page.fill('[name=card_number]', '4242');
  await page.click('#next');
  await expect(page.locator('h2')).toContainText('Welcome');
  await page.close({ runBeforeUnload: true });
  await ctx.close();

  await expect
    .poll(() => psql(`SELECT count(*) FROM "ConversionLog" l JOIN "ConversionDestination" d ON d.id = l."destinationId" WHERE l."createdAt" > now() - interval '2 minutes' AND l.response LIKE '%Cj0e2e%'`), { timeout: 20_000 })
    .not.toBe('0');
  const rows = psql(
    `SELECT d.type || ':' || l."eventName" || ':' || l.status FROM "ConversionLog" l JOIN "ConversionDestination" d ON d.id = l."destinationId" WHERE l."createdAt" > now() - interval '2 minutes' ORDER BY 1`,
  ).split('\n');
  // Google: purchase + onboarding_completed with gclid; Meta: always; TikTok: no ttclid and no email hash on the event → dry-run still formed
  expect(rows).toEqual(expect.arrayContaining(['GOOGLE_ADS:purchase → purchase:dry_run', 'META_CAPI:purchase → Purchase:dry_run', 'META_CAPI:onboarding_completed → CompleteRegistration:dry_run']));
});
