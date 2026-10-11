import { RemoteConfig } from '@weart/shared';
import type { Redis } from 'ioredis';

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  experiments: [],
  replay_sample_rate: 0.25,
  snapshot_sample_rate: 0.05,
  capture_fields: [],
};

/** Remote SDK config per site, published to Redis by the worker from Postgres (key wa:config:{site}). */
export interface ConfigSource {
  get(site: string): Promise<RemoteConfig>;
}

export class RedisConfigSource implements ConfigSource {
  private cache = new Map<string, { at: number; cfg: RemoteConfig }>();
  constructor(private readonly redis: Redis) {}

  async get(site: string): Promise<RemoteConfig> {
    const hit = this.cache.get(site);
    if (hit && Date.now() - hit.at < 30_000) return hit.cfg;
    let cfg = DEFAULT_REMOTE_CONFIG;
    try {
      const raw = this.redis.status === 'ready' ? await this.redis.get(`wa:config:${site}`) : null;
      if (raw) cfg = RemoteConfig.parse(JSON.parse(raw));
    } catch {
      /* fall back to default */
    }
    this.cache.set(site, { at: Date.now(), cfg });
    return cfg;
  }
}
