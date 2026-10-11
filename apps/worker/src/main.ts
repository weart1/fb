import { decryptJson, prisma } from '@weart/db';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { publishRemoteConfig } from './config-publisher';
import type { GoogleAdsCreds } from './destinations/google';
import type { MetaCreds } from './destinations/meta';
import type { TikTokCreds } from './destinations/tiktok';
import { forwardConversion, type ResolvedDestination } from './forward';
import { googleAccessToken } from './google-auth';
import type { ConversionJob } from './job';

const env = process.env;
const log = (msg: string, meta?: Record<string, unknown>): void => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...meta }));

/** Credentials from the encrypted DB column, falling back to env vars (single-project setups). */
async function resolveCreds(type: ResolvedDestination['type'], encrypted: string | null): Promise<ResolvedDestination['creds']> {
  const stored = encrypted ? decryptJson<Record<string, unknown>>(encrypted) : {};
  const pick = (k: string, envKey: string): string => String(stored[k] ?? env[envKey] ?? '');
  switch (type) {
    case 'META_CAPI': {
      const c: MetaCreds = { pixel_id: pick('pixel_id', 'META_PIXEL_ID'), access_token: pick('access_token', 'META_CAPI_ACCESS_TOKEN') };
      const test = pick('test_event_code', 'META_TEST_EVENT_CODE');
      if (test) c.test_event_code = test;
      return c.pixel_id && c.access_token ? c : null;
    }
    case 'TIKTOK_EVENTS': {
      const c: TikTokCreds = { pixel_code: pick('pixel_code', 'TIKTOK_PIXEL_CODE'), access_token: pick('access_token', 'TIKTOK_EVENTS_ACCESS_TOKEN') };
      return c.pixel_code && c.access_token ? c : null;
    }
    case 'GOOGLE_ADS': {
      const refresh = pick('refresh_token', 'GOOGLE_ADS_REFRESH_TOKEN');
      const clientId = pick('client_id', 'GOOGLE_ADS_OAUTH_CLIENT_ID');
      const secret = pick('client_secret', 'GOOGLE_ADS_OAUTH_CLIENT_SECRET');
      const customer = pick('customer_id', 'GOOGLE_ADS_CUSTOMER_ID');
      const devToken = pick('developer_token', 'GOOGLE_ADS_DEVELOPER_TOKEN');
      if (!refresh || !clientId || !secret || !customer || !devToken) return null;
      const actions = (stored.conversion_actions as Record<string, string> | undefined) ?? {
        onboarding_completed: env.GOOGLE_ADS_CONVERSION_ACTION_ID ?? '',
        purchase: env.GOOGLE_ADS_CONVERSION_ACTION_ID ?? '',
      };
      const c: GoogleAdsCreds = {
        customer_id: customer,
        developer_token: devToken,
        access_token: await googleAccessToken(clientId, secret, refresh),
        conversion_actions: actions,
      };
      return c;
    }
  }
}

const destCache = new Map<string, { at: number; list: ResolvedDestination[] }>();

async function destinations(siteId: string): Promise<ResolvedDestination[]> {
  const hit = destCache.get(siteId);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  const project = await prisma.project.findUnique({ where: { siteId }, include: { destinations: true } });
  const list: ResolvedDestination[] = [];
  for (const d of project?.destinations ?? []) {
    list.push({
      id: d.id,
      type: d.type,
      enabled: d.enabled,
      dryRun: d.dryRun,
      creds: d.enabled ? await resolveCreds(d.type, d.credentials) : null,
      eventMap: (d.eventMap ?? {}) as Record<string, string>,
    });
  }
  destCache.set(siteId, { at: Date.now(), list });
  return list;
}

async function main(): Promise<void> {
  const redisUrl = env.REDIS_URL ?? 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const redis = new Redis(redisUrl);

  const worker = new Worker<ConversionJob>(
    'conversions',
    async (job) =>
      forwardConversion(
        job.data,
        {
          destinations,
          record: async (destinationId, j, platformEvent, result) => {
            await prisma.conversionLog.upsert({
              where: { destinationId_eventId: { destinationId, eventId: j.event_id } },
              create: { destinationId, eventId: j.event_id, eventName: `${j.event} → ${platformEvent}`, status: result.status, response: result.response ?? null },
              update: { status: result.status, response: result.response ?? null, attempts: { increment: 1 } },
            });
          },
          http: (url, init) => fetch(url, init),
          log,
        },
        async (destinationId) =>
          (await prisma.conversionLog.count({ where: { destinationId, eventId: job.data.event_id, status: { in: ['sent', 'dry_run'] } } })) > 0,
      ),
    { connection, concurrency: 8 },
  );
  worker.on('failed', (job, err) => log('conversion job failed', { id: job?.id, attempts: job?.attemptsMade, err: err.message }));

  const publish = async (): Promise<void> => {
    try {
      const n = await publishRemoteConfig(prisma, redis);
      log('remote config published', { projects: n });
    } catch (err) {
      log('remote config publish failed', { err: String(err) });
    }
  };
  await publish();
  const timer = setInterval(() => void publish(), 60_000);

  log('worker started', { queues: ['conversions'] });
  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await worker.close();
    await prisma.$disconnect();
    connection.disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
