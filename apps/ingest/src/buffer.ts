import type { ClickHouseClient } from '@weart/queries';

/**
 * Batches rows per table and writes them to ClickHouse every `intervalMs` or `maxRows`.
 * On write failure rows are kept and retried with backoff. When the buffer exceeds
 * `capacity`, `accepting` turns false and the HTTP layer answers 503, so SDKs keep
 * the events in their offline retry queue (backpressure instead of data loss).
 */
export class InsertBuffer {
  private tables = new Map<string, unknown[]>();
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | undefined;
  private backoffUntil = 0;
  private failures = 0;
  inserted = 0;

  constructor(
    private readonly ch: ClickHouseClient,
    private readonly opts: { intervalMs: number; maxRows: number; capacity: number; log: (msg: string, err?: unknown) => void },
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.opts.intervalMs);
    this.timer.unref();
  }

  get size(): number {
    let n = 0;
    for (const rows of this.tables.values()) n += rows.length;
    return n;
  }

  get accepting(): boolean {
    return this.size < this.opts.capacity;
  }

  push(table: string, rows: unknown[]): void {
    if (!rows.length) return;
    let t = this.tables.get(table);
    if (!t) this.tables.set(table, (t = []));
    for (const r of rows) t.push(r);
    if (t.length >= this.opts.maxRows) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (Date.now() < this.backoffUntil) return;
    this.flushing = this.doFlush().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    for (const [table, rows] of this.tables) {
      if (!rows.length) continue;
      const chunk = rows.splice(0, rows.length);
      try {
        await this.ch.insert({ table, values: chunk, format: 'JSONEachRow', clickhouse_settings: { async_insert: 0 } });
        this.inserted += chunk.length;
        this.failures = 0;
      } catch (err) {
        rows.unshift(...chunk);
        this.failures++;
        this.backoffUntil = Date.now() + Math.min(30_000, 500 * 2 ** this.failures);
        this.opts.log(`insert into ${table} failed (${chunk.length} rows kept, attempt ${this.failures})`, err);
        return;
      }
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.backoffUntil = 0;
    await this.flush();
  }
}
