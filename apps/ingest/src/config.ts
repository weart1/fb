import { z } from 'zod';

const Env = z.object({
  INGEST_PORT: z.coerce.number().int().default(4318),
  INGEST_HOST: z.string().default('0.0.0.0'),
  INGEST_ALLOWED_ORIGINS: z.string().default('*'),
  INGEST_COOKIE_DOMAIN: z.string().default(''),
  INGEST_SITE_IDS: z.string().default('weartstudio'),
  TRUST_PROXY: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  GEOIP_DB_PATH: z.string().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().default('http://localhost:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('weart'),
  S3_SECRET_KEY: z.string().default('weartsecret'),
  S3_BUCKET: z.string().default('weart-blobs'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  /** Include the client IP in conversion-forwarding jobs (improves Meta/TikTok match quality). Never stored in ClickHouse. */
  FORWARD_CLIENT_IP: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SDK_DIST_DIR: z.string().default(''),
  FLUSH_INTERVAL_MS: z.coerce.number().int().default(1000),
  FLUSH_MAX_ROWS: z.coerce.number().int().default(5000),
  BUFFER_MAX_ROWS: z.coerce.number().int().default(200_000),
});

export type IngestConfig = z.infer<typeof Env> & { sites: Set<string>; origins: string[] | '*' };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const c = Env.parse(env);
  const origins = c.INGEST_ALLOWED_ORIGINS.trim() === '*' ? '*' : c.INGEST_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return { ...c, sites: new Set(c.INGEST_SITE_IDS.split(',').map((s) => s.trim())), origins };
}
