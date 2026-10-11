/**
 * Seeds realistic ad traffic so every dashboard screen has meaningful data immediately.
 *
 *   pnpm seed                 # 60 days, ~1.5M events (default)
 *   pnpm seed --days 30 --scale 0.5
 *
 * ClickHouse: truncates and refills `events` (materialized views fill sessions, flow_steps,
 * form_fields, visitors). Postgres: workspace, owner login, project, onboarding flow definition,
 * conversion destinations (dry-run) and daily ad spend per ad. Also writes output/ad_spend.csv
 * to exercise the CSV import.
 */
import { hashPassword, prisma, type AdPlatform } from '@weart/db';
import { createClickHouse, serializeEventRow, type EventRow } from '@weart/queries';
import { ONBOARDING_3 } from '@weart/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPAIGNS, DEVICE_MIX, type Campaign } from './catalog';
import { Rng } from './rng';
import { newVisitor, organicTouch, paidTouch, PROJECT, simulateSession, type Touch, type Visitor } from './simulate';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : def;
};
const DAYS = arg('days', 60);
const SCALE = arg('scale', 1);
const PAID_PER_DAY = 980 * SCALE;
const ORGANIC_PER_DAY = 320 * SCALE;
const DAY_MS = 86400_000;
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'admin@weartstudio.io';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'weart-demo-2026';

/** UTC hour weights: EU evening + US evening peaks */
const HOURS: Array<readonly [number, number]> = Array.from({ length: 24 }, (_, h) => [h, 2 + 3 * Math.exp(-((h - 19) ** 2) / 10) + 2.5 * Math.exp(-((h - 1) ** 2) / 8) + 1.5 * Math.exp(-((h - 13) ** 2) / 12)] as const);

interface SpendKey {
  date: string;
  c: Campaign;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const rng = new Rng(20261011);
  const ch = createClickHouse();
  const end = Math.floor(Date.now() / 60_000) * 60_000;
  const firstDay = Math.floor(end / DAY_MS) * DAY_MS - (DAYS - 1) * DAY_MS;

  console.log(`seed: ${DAYS} days from ${new Date(firstDay).toISOString().slice(0, 10)}, scale ${SCALE}`);
  for (const table of ['events', 'sessions', 'flow_steps', 'form_fields', 'visitors', 'identities', 'replay_chunks', 'page_snapshots', 'ingest_stats']) {
    await ch.command({ query: `TRUNCATE TABLE IF EXISTS ${table}` });
  }

  let buffer: EventRow[] = [];
  let total = 0;
  let sessions = 0;
  let completions = 0;
  const flush = async (force = false): Promise<void> => {
    if (!force && buffer.length < 100_000) return;
    if (!buffer.length) return;
    const chunk = buffer;
    buffer = [];
    await ch.insert({ table: 'events', values: chunk.map(serializeEventRow), format: 'JSONEachRow', clickhouse_settings: { async_insert: 0 } });
    total += chunk.length;
    process.stdout.write(`\r  events inserted: ${total.toLocaleString()}`);
  };

  const spend = new Map<string, SpendKey & { sessions: number }>();
  const identities = new Map<string, string>();
  const returning: Array<{ v: Visitor; at: number }> = [];

  const runSession = async (v: Visitor, touch: Touch | undefined, at: number, day: number): Promise<void> => {
    if (at > end) return;
    if (touch) {
      v.lastTouch = touch;
      v.firstTouch ??= touch;
    } else if (!v.firstTouch) {
      v.firstTouch = { utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '', campaign_id: '', adset_id: '', ad_id: '', creative_id: '', click_id_type: '', click_id: '', referrer: '', landing_path: '/', ts: at };
    }
    // direct returns inherit the last non-direct touch within 30 days (same rule as the SDK)
    const sessionTouch = touch ?? (v.lastTouch && at - v.lastTouch.ts < 30 * DAY_MS ? v.lastTouch : undefined);
    const r = simulateSession(rng, v, sessionTouch, at, day);
    buffer.push(...r.rows.filter((e) => e.ts <= end));
    sessions++;
    if (r.completed) completions++;
    if (v.userId) identities.set(v.anon, v.userId);
    // some visitors come back later (direct, brand search, or retargeting)
    if (!v.completed && v.sessions < 4 && rng.chance(r.maxStep >= 3 ? 0.32 : 0.12)) {
      returning.push({ v, at: at + rng.logNormal(2 * DAY_MS, 1.0) });
    }
    await flush();
  };

  const spendKey = (date: string, c: Campaign, t: Touch): string => `${date}|${c.id}|${t.adset_id}|${t.ad_id}`;

  for (let day = 0; day < DAYS; day++) {
    const dayStart = firstDay + day * DAY_MS;
    const date = new Date(dayStart).toISOString().slice(0, 10);
    const dow = new Date(dayStart).getUTCDay();
    const weekly = dow === 0 || dow === 6 ? 1.15 : dow === 1 ? 0.9 : 1;
    const growth = 0.85 + (0.3 * day) / DAYS;
    const noise = 0.9 + rng.next() * 0.2;
    const at = (): number => dayStart + rng.weighted(HOURS) * 3600_000 + rng.int(0, 3599_999);

    const active = CAMPAIGNS.filter((c) => day >= c.startDay && (c.endDay === undefined || day <= c.endDay));
    const weightSum = CAMPAIGNS.reduce((a, c) => a + c.weight, 0);
    for (const c of active) {
      const n = Math.round(((PAID_PER_DAY * c.weight) / weightSum) * weekly * growth * noise);
      for (let i = 0; i < n; i++) {
        const adset = rng.weighted(c.adsets.map((a) => [a, a.weight] as const));
        const ad = rng.weighted(adset.ads.map((a) => [a, a.weight] as const));
        const mix = c.platform === 'meta' ? (rng.chance(0.62) ? DEVICE_MIX.meta_ig : DEVICE_MIX.meta_fb) : DEVICE_MIX[c.platform];
        const ts = at();
        // retargeting reaches people who already visited
        const prior = c.name.includes('Retargeting') && returning.length ? returning.splice(rng.int(0, returning.length - 1), 1)[0]?.v : undefined;
        const v = prior ?? newVisitor(rng, mix, ts);
        const touch = paidTouch(rng, c, adset, ad, ts, v.device);
        const key = spendKey(date, c, touch);
        const s = spend.get(key) ?? { date, c, adsetId: adset.id, adsetName: adset.name, adId: ad.id, adName: ad.name, creativeId: ad.creativeId, sessions: 0 };
        s.sessions++;
        spend.set(key, s);
        await runSession(v, touch, ts, day);
      }
    }
    const organic = Math.round(ORGANIC_PER_DAY * weekly * noise);
    for (let i = 0; i < organic; i++) {
      const ts = at();
      await runSession(newVisitor(rng, DEVICE_MIX.organic, ts), organicTouch(rng, ts), ts, day);
    }
    // returning visitors due today
    for (let i = returning.length - 1; i >= 0; i--) {
      const r = returning[i]!;
      if (r.at >= dayStart && r.at < dayStart + DAY_MS) {
        returning.splice(i, 1);
        const touch = rng.chance(0.25) ? organicTouch(rng, r.at) : undefined;
        await runSession(r.v, touch?.referrer.includes('google') ? touch : undefined, r.at, day);
      }
    }
  }
  await flush(true);
  process.stdout.write('\n');

  // identities (anonymous → user) for identified visitors
  const idRows = [...identities].map(([anonymous_id, user_id]) => ({ project_id: PROJECT, anonymous_id, user_id, updated_at: new Date(end).toISOString().replace('T', ' ').replace('Z', '') }));
  for (let i = 0; i < idRows.length; i += 50_000) await ch.insert({ table: 'identities', values: idRows.slice(i, i + 50_000), format: 'JSONEachRow' });

  // ---------------------------------------------------------------- Postgres
  await prisma.workspace.deleteMany({ where: { name: 'weart studio' } });
  const passwordHash = await hashPassword(OWNER_PASSWORD);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    create: { email: OWNER_EMAIL, name: 'weart admin', passwordHash },
    update: { passwordHash },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'weart studio', memberships: { create: { userId: owner.id, role: 'OWNER' } } },
  });
  await prisma.project.deleteMany({ where: { siteId: PROJECT } });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      siteId: PROJECT,
      name: 'weartstudio.io',
      domain: 'weartstudio.io',
      timezone: 'UTC',
      currency: 'USD',
      captureFields: ['style_choice', 'goal', 'experience_level', 'plan_choice', 'billing_period'],
      flows: { create: { flowId: ONBOARDING_3.id, path: ONBOARDING_3.path, label: ONBOARDING_3.label, steps: ONBOARDING_3.steps as unknown as object } },
      destinations: {
        create: [
          { type: 'META_CAPI', enabled: true, dryRun: true, eventMap: { onboarding_completed: 'CompleteRegistration', sign_up: 'Lead', purchase: 'Purchase' } },
          { type: 'GOOGLE_ADS', enabled: true, dryRun: true, eventMap: { onboarding_completed: 'onboarding_completed', purchase: 'purchase' } },
          { type: 'TIKTOK_EVENTS', enabled: true, dryRun: true, eventMap: { onboarding_completed: 'CompleteRegistration', purchase: 'CompletePayment' } },
        ],
      },
    },
  });

  const platformEnum: Record<Campaign['platform'], AdPlatform> = { meta: 'META', google: 'GOOGLE', tiktok: 'TIKTOK' };
  const imp = await prisma.adSpendImport.create({ data: { projectId: project.id, source: 'seed', rows: spend.size, createdBy: owner.id } });
  const spendRows = [...spend.values()].map((s) => {
    const clicks = Math.round(s.sessions / (1 - s.c.clickLoss));
    const cpc = s.c.cpc * (0.85 + rng.next() * 0.3);
    return {
      projectId: project.id,
      date: new Date(`${s.date}T00:00:00Z`),
      platform: platformEnum[s.c.platform],
      campaignId: s.c.id,
      campaignName: s.c.name,
      adsetId: s.adsetId,
      adsetName: s.adsetName,
      adId: s.adId,
      adName: s.adName,
      creativeId: s.creativeId,
      creativeName: s.adName,
      spend: (clicks * cpc).toFixed(2),
      currency: 'USD',
      clicks,
      impressions: Math.round(clicks / (s.c.ctr * (0.85 + rng.next() * 0.3))),
      importId: imp.id,
    };
  });
  for (let i = 0; i < spendRows.length; i += 1000) await prisma.adSpend.createMany({ data: spendRows.slice(i, i + 1000) });

  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'output');
  mkdirSync(out, { recursive: true });
  const csv = ['date,platform,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,currency,impressions,clicks'];
  for (const r of spendRows) {
    csv.push([r.date.toISOString().slice(0, 10), r.platform, r.campaignId, r.campaignName, r.adsetId, r.adsetName, r.adId, r.adName, r.spend, r.currency, r.impressions, r.clicks].map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
  }
  writeFileSync(join(out, 'ad_spend.csv'), `${csv.join('\n')}\n`);

  const totalSpend = spendRows.reduce((a, r) => a + Number(r.spend), 0);
  console.log(`seed: ${total.toLocaleString()} events, ${sessions.toLocaleString()} sessions, ${completions.toLocaleString()} onboarding completions, ${identities.size.toLocaleString()} identified users`);
  console.log(`seed: ${spendRows.length.toLocaleString()} ad spend rows ($${Math.round(totalSpend).toLocaleString()}), csv → tools/seed/output/ad_spend.csv`);
  console.log(`seed: login ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`seed: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await ch.close();
  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
