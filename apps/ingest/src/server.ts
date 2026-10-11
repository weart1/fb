import cors from '@fastify/cors';
import { chTime, serializeEventRow, type IdentityRow, type PageSnapshotRow, type ReplayChunkRow } from '@weart/queries';
import { Batch, isBotUserAgent, PageSnapshot, ReplayChunk } from '@weart/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LRUCache } from 'lru-cache';
import type { BlobStore } from './blobs';
import type { IngestConfig } from './config';
import type { Deduper } from './dedup';
import { enrichBatch } from './enrich';
import { conversionJobs, type ConversionSink } from './forwarding';
import type { GeoResolver } from './geo';
import type { ConfigSource } from './remote-config';
import { parseUA } from './ua';

export interface RowSink {
  push(table: string, rows: unknown[]): void;
  readonly accepting: boolean;
  readonly size: number;
}

export interface Deps {
  cfg: IngestConfig;
  sink: RowSink;
  dedup: Deduper;
  geo: GeoResolver;
  blobs: BlobStore;
  conversions: ConversionSink;
  remoteConfig: ConfigSource;
  sdkDir: string;
}

type Counter = 'accepted' | 'dropped_bot' | 'dropped_duplicate' | 'dropped_invalid' | 'dropped_consent';

export function buildServer(deps: Deps): FastifyInstance {
  const { cfg, sink } = deps;
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 4 * 1024 * 1024,
  });

  // The SDK posts text/plain (CORS simple request, no preflight); accept JSON too.
  app.addContentTypeParser(['text/plain', 'application/json'], { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error('invalid json') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  void app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || cfg.origins === '*' || cfg.origins.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
    maxAge: 86400,
  });

  // ---- per-minute health counters → ingest_stats
  const counters = new Map<string, Record<Counter, number>>();
  const count = (project: string, k: Counter, n = 1): void => {
    let c = counters.get(project);
    if (!c) counters.set(project, (c = { accepted: 0, dropped_bot: 0, dropped_duplicate: 0, dropped_invalid: 0, dropped_consent: 0 }));
    c[k] += n;
  };
  const statsTimer = setInterval(() => {
    const minute = chTime(Math.floor(Date.now() / 60_000) * 60_000).slice(0, 19);
    const rows = [...counters].map(([project_id, c]) => ({ project_id, minute, ...c }));
    counters.clear();
    sink.push('ingest_stats', rows);
  }, 60_000);
  statsTimer.unref();
  app.addHook('onClose', async () => clearInterval(statsTimer));

  const knownIdentities = new LRUCache<string, true>({ max: 100_000 });

  const siteOk = (site: string, reply: FastifyReply): boolean => {
    if (cfg.sites.has(site)) return true;
    void reply.code(400).send({ error: 'unknown_site' });
    return false;
  };
  const userAgent = (req: FastifyRequest): string => String(req.headers['user-agent'] ?? '');

  app.post('/v1/batch', { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const parsed = Batch.safeParse(req.body);
    if (!parsed.success) {
      count('unknown', 'dropped_invalid');
      return reply.code(400).send({ error: 'invalid_batch', issues: parsed.error.issues.slice(0, 5) });
    }
    const batch = parsed.data;
    if (!siteOk(batch.site, reply)) return reply;
    const projectId = batch.site;
    const ua = userAgent(req);
    if (isBotUserAgent(ua)) {
      count(projectId, 'dropped_bot', batch.events.length);
      return reply.code(204).send();
    }
    if (!sink.accepting) {
      return reply.code(503).header('Retry-After', '5').send({ error: 'busy' });
    }

    const fresh = await deps.dedup.check(batch.events.map((e) => e.id));
    const events = batch.events.filter((_, i) => fresh[i]);
    count(projectId, 'dropped_duplicate', batch.events.length - events.length);
    if (events.length) {
      const receivedAt = Date.now();
      const { rows, rejected } = enrichBatch(
        { ...batch, events },
        { projectId, receivedAt, ua: parseUA(ua), geo: deps.geo.lookup(req.ip, req.headers) },
      );
      count(projectId, 'dropped_invalid', rejected);
      count(projectId, 'accepted', rows.length);
      sink.push('events', rows.map(serializeEventRow));

      const userId = batch.ctx.user_id;
      const identityKey = `${batch.ctx.anonymous_id}:${userId}`;
      if (userId && !knownIdentities.has(identityKey)) {
        knownIdentities.set(identityKey, true);
        const identity: IdentityRow = { project_id: projectId, anonymous_id: batch.ctx.anonymous_id, user_id: userId, updated_at: receivedAt };
        sink.push('identities', [{ ...identity, updated_at: chTime(receivedAt) }]);
      }

      const jobs = conversionJobs(rows, ua, cfg.FORWARD_CLIENT_IP ? req.ip : undefined);
      if (jobs.length) deps.conversions.enqueue(jobs).catch((err: unknown) => req.log.error({ err }, 'conversion enqueue failed'));
    }

    // Server-set first-party cookie: not subject to Safari ITP's 7-day cap on JS cookies
    // (when ingest runs on a first-party subdomain such as e.weartstudio.io).
    let cookie = `wa_id=${batch.ctx.anonymous_id}; Path=/; Max-Age=${400 * 86400}; SameSite=Lax`;
    if (cfg.INGEST_COOKIE_DOMAIN) cookie += `; Domain=${cfg.INGEST_COOKIE_DOMAIN}; Secure`;
    void reply.header('Set-Cookie', cookie);
    return reply.code(202).send({ ok: true, accepted: events.length });
  });

  app.post('/v1/replay', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const parsed = ReplayChunk.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_chunk' });
    const c = parsed.data;
    if (!siteOk(c.site, reply)) return reply;
    if (isBotUserAgent(userAgent(req))) return reply.code(204).send();
    const key = `replays/${c.site}/${c.session_id}/${String(c.seq).padStart(6, '0')}.json.gz`;
    const bytes = await deps.blobs.putJson(key, c.events);
    const row: ReplayChunkRow = {
      project_id: c.site,
      session_id: c.session_id,
      seq: c.seq,
      anonymous_id: c.anonymous_id,
      first_ts: c.first_ts,
      last_ts: c.last_ts,
      events: c.events.length,
      bytes,
      object_key: key,
      received_at: Date.now(),
    };
    sink.push('replay_chunks', [{ ...row, first_ts: chTime(row.first_ts), last_ts: chTime(row.last_ts), received_at: chTime(row.received_at) }]);
    return reply.code(202).send({ ok: true });
  });

  app.post('/v1/snapshot', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const parsed = PageSnapshot.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_snapshot' });
    const s = parsed.data;
    if (!siteOk(s.site, reply)) return reply;
    const ua = parseUA(userAgent(req));
    const now = Date.now();
    const id = createHash('sha1').update(`${s.path}|${s.step_key ?? ''}|${ua.device_type}`).digest('hex').slice(0, 16);
    const key = `snapshots/${s.site}/${id}/${now}.json.gz`;
    await deps.blobs.putJson(key, s.snapshot);
    const row: PageSnapshotRow = {
      project_id: s.site,
      path: s.path,
      step_key: s.step_key ?? '',
      device_type: ua.device_type,
      viewport_w: s.viewport_w,
      doc_h: s.doc_h,
      object_key: key,
      captured_at: now,
    };
    sink.push('page_snapshots', [{ ...row, captured_at: chTime(now) }]);
    return reply.code(202).send({ ok: true });
  });

  app.get<{ Querystring: { site?: string } }>('/v1/config', async (req, reply) => {
    const site = req.query.site ?? '';
    if (!siteOk(site, reply)) return reply;
    const cfgOut = await deps.remoteConfig.get(site);
    return reply.header('Cache-Control', 'public, max-age=300').send(cfgOut);
  });

  const SDK_FILES = new Set(['weart.js', 'weart-replay.js']);
  app.get<{ Params: { file: string } }>('/sdk/:file', async (req, reply) => {
    if (!SDK_FILES.has(req.params.file)) return reply.code(404).send();
    try {
      const js = await readFile(join(deps.sdkDir, req.params.file));
      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
        .header('Access-Control-Allow-Origin', '*')
        .send(js);
    } catch {
      return reply.code(404).send({ error: 'sdk not built: run pnpm --filter @weart/sdk build' });
    }
  });

  app.get('/health', async () => ({ ok: true, buffered: sink.size, accepting: sink.accepting, geo: deps.geo.hasDatabase }));

  return app;
}
