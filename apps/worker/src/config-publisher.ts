import type { PrismaClient } from '@weart/db';
import type { RemoteConfig } from '@weart/shared';
import type { Redis } from 'ioredis';

/**
 * Publishes the SDK remote config (sampling, whitelisted fields, experiments) from Postgres to
 * Redis, where ingest serves it from /v1/config. Keeps ingest independent from Postgres.
 */
export async function publishRemoteConfig(prisma: PrismaClient, redis: Redis): Promise<number> {
  const projects = await prisma.project.findMany();
  for (const p of projects) {
    const cfg: RemoteConfig = {
      experiments: [], // populated from the Experiment model in milestone 8
      replay_sample_rate: p.replaySampleRate,
      snapshot_sample_rate: p.snapshotSampleRate,
      capture_fields: p.captureFields,
    };
    await redis.set(`wa:config:${p.siteId}`, JSON.stringify(cfg));
  }
  return projects.length;
}
