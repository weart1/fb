import type { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';

/** Drops events already seen in the last 15 minutes (SDK retries, beacon + fetch double sends). */
export interface Deduper {
  /** Returns a boolean per id: true = new, false = duplicate */
  check(ids: string[]): Promise<boolean[]>;
}

const TTL_SECONDS = 15 * 60;

export class MemoryDeduper implements Deduper {
  private seen = new LRUCache<string, true>({ max: 500_000, ttl: TTL_SECONDS * 1000 });
  async check(ids: string[]): Promise<boolean[]> {
    return ids.map((id) => {
      if (this.seen.has(id)) return false;
      this.seen.set(id, true);
      return true;
    });
  }
}

/** Shared across ingest replicas. Falls back to the in-process LRU if Redis is unavailable. */
export class RedisDeduper implements Deduper {
  private fallback = new MemoryDeduper();
  constructor(
    private readonly redis: Redis,
    private readonly onError: (err: unknown) => void,
  ) {}

  async check(ids: string[]): Promise<boolean[]> {
    if (this.redis.status !== 'ready') return this.fallback.check(ids);
    try {
      const pipe = this.redis.pipeline();
      for (const id of ids) pipe.set(`wa:ev:${id}`, '1', 'EX', TTL_SECONDS, 'NX');
      const res = await pipe.exec();
      return (res ?? []).map(([err, val]) => !!err || val === 'OK');
    } catch (err) {
      this.onError(err);
      return this.fallback.check(ids);
    }
  }
}
