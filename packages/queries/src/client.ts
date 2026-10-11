import { createClient, type ClickHouseClient } from '@clickhouse/client';

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export function clickhouseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL ?? 'http://localhost:8123',
    username: env.CLICKHOUSE_USER ?? 'weart',
    password: env.CLICKHOUSE_PASSWORD ?? 'weart',
    database: env.CLICKHOUSE_DB ?? 'weart',
  };
}

export function createClickHouse(cfg: ClickHouseConfig = clickhouseConfigFromEnv()): ClickHouseClient {
  return createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    request_timeout: 60_000,
    compression: { request: true, response: true },
    clickhouse_settings: {
      date_time_input_format: 'best_effort',
      output_format_json_quote_64bit_integers: 0,
    },
  });
}

export type { ClickHouseClient };
