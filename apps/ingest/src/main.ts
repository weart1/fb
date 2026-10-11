import { createClickHouse } from '@weart/queries';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3BlobStore } from './blobs';
import { InsertBuffer } from './buffer';
import { loadConfig } from './config';
import { RedisDeduper } from './dedup';
import { BullConversionSink, CONVERSIONS_QUEUE } from './forwarding';
import { GeoResolver } from './geo';
import { RedisConfigSource } from './remote-config';
import { buildServer } from './server';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ch = createClickHouse();
  const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  const queueRedis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const blobs = new S3BlobStore(cfg);
  const geo = await GeoResolver.create(cfg.GEOIP_DB_PATH ? resolve(here, '../../..', cfg.GEOIP_DB_PATH) : '');

  let app: ReturnType<typeof buildServer> | undefined;
  const log = (msg: string, err?: unknown): void => (app ? app.log.error({ err }, msg) : console.error(msg, err));
  const buffer = new InsertBuffer(ch, { intervalMs: cfg.FLUSH_INTERVAL_MS, maxRows: cfg.FLUSH_MAX_ROWS, capacity: cfg.BUFFER_MAX_ROWS, log });
  buffer.start();
  redis.on('error', (err) => log('redis error', err));

  app = buildServer({
    cfg,
    sink: buffer,
    dedup: new RedisDeduper(redis, (err) => log('dedup redis error', err)),
    geo,
    blobs,
    conversions: new BullConversionSink(new Queue(CONVERSIONS_QUEUE, { connection: queueRedis })),
    remoteConfig: new RedisConfigSource(redis),
    sdkDir: cfg.SDK_DIST_DIR || join(here, '../../../packages/sdk/dist'),
  });

  await blobs.ensureBucket().catch((err: unknown) => log('object storage unavailable (replays/snapshots will fail)', err));
  if (!geo.hasDatabase) app.log.warn('no GeoIP database: geo falls back to CDN headers (run pnpm --filter @weart/ingest geoip:download)');

  const shutdown = async (signal: string): Promise<void> => {
    app?.log.info(`${signal}: draining`);
    await app?.close();
    await buffer.close();
    await ch.close();
    redis.disconnect();
    queueRedis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: cfg.INGEST_PORT, host: cfg.INGEST_HOST });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
