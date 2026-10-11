import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@clickhouse/client';
import { clickhouseConfigFromEnv, createClickHouse } from './client';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Split a migration file into statements: a statement ends with `;` at the end of a line. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);
}

export async function migrate(log: (msg: string) => void = console.log): Promise<void> {
  const cfg = clickhouseConfigFromEnv();
  // Database may not exist yet: connect without it first.
  const admin = createClient({ url: cfg.url, username: cfg.username, password: cfg.password });
  await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${cfg.database.replace(/[^a-zA-Z0-9_]/g, '')}` });
  await admin.close();

  const ch = createClickHouse(cfg);
  await ch.command({
    query: `CREATE TABLE IF NOT EXISTS schema_migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY name`,
  });
  const applied = new Set(
    (await (await ch.query({ query: 'SELECT name FROM schema_migrations', format: 'JSONEachRow' })).json<{ name: string }>()).map(
      (r) => r.name,
    ),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of splitStatements(sql)) {
      await ch.command({ query: statement });
    }
    await ch.insert({ table: 'schema_migrations', values: [{ name: file }], format: 'JSONEachRow' });
    log(`clickhouse: applied ${file}`);
  }
  await ch.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(
    () => console.log('clickhouse: up to date'),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
