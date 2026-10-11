# weart analytics: architecture plan

Status: **approved, milestone 1 done** (SDK, ingest, schema, seed, conversion forwarding in dry-run).
The original plan below was written for the first brief; the extended brief changes it as described in
"Extended scope" at the end. Where they differ, the extended scope and the README "Decisions" table win.

---

## 1. Architecture

```
 weartstudio.io (browser)                     e.weartstudio.io  (first-party ingest subdomain)
┌──────────────────────────────┐   batch POST  ┌───────────────────────────────────────────┐
│ @weart/sdk  core  (<10 KB gz)│ ────────────▶ │ apps/ingest  (Fastify, Node 22)           │
│  - ids, attribution, consent │   sendBeacon  │  1. Zod validate  2. bot filter           │
│  - autocapture, forms, errors│               │  3. enrich: UA parse, geo (IP → city, IP  │
│  - batching + retry queue    │               │     dropped), server ts / clock skew fix  │
│ replay.js (lazy, rrweb)      │ ────────────▶ │  4. dedup (event_id LRU)                  │
└──────────────────────────────┘               │  5. in-memory buffer → ClickHouse batch   │
                                               │     insert (async_insert, 1 s / 5k rows)  │
                                               │  6. conversion-forwarding outbox          │
                                               └──────────────┬──────────────┬─────────────┘
                                                              │              │
                                     ┌────────────────────────▼───┐   ┌──────▼─────────────────┐
                                     │ ClickHouse                 │   │ Meta CAPI / Google Ads │
                                     │ events (raw, partition by  │   │ (stubbed, dry-run by   │
                                     │ month, TTL = retention)    │   │  default)              │
                                     │ + materialized views       │   └────────────────────────┘
                                     └────────────▲───────────────┘
                                                  │ parameterized SQL only
┌─────────────────────────────────────────────────┴───────────────────────────────────────┐
│ apps/dashboard  (Next.js App Router)                                                     │
│  route handlers /api/q/*  →  packages/queries (typed query layer)                        │
│  TanStack Query on client, ECharts, TanStack Table, shadcn/ui                            │
│  auth, segments, ad spend, settings  →  packages/db (Prisma) → PostgreSQL                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Monorepo (pnpm + Turborepo)

| Path | Purpose |
|---|---|
| `apps/dashboard` | Next.js 15 App Router, TS strict, Tailwind, shadcn/ui, TanStack Table/Query, ECharts, date-fns |
| `apps/ingest` | Fastify ingestion service + conversion forwarding worker |
| `packages/sdk` | Browser SDK (core bundle + lazy `replay` bundle), built with tsup/esbuild, size-limit check in CI |
| `packages/shared` | Zod event schemas, event name constants, filter/DTO types shared by SDK, ingest, dashboard |
| `packages/queries` *(added)* | ClickHouse client + every analytics query as a typed function. Separate so it is unit-testable against a real ClickHouse in Vitest and reusable by the seed script and ingest |
| `packages/db` *(added)* | Prisma schema + client for Postgres |
| `packages/clickhouse` *(folded into `queries`)* | migrations in `packages/queries/migrations/*.sql`, applied by a small runner |
| `tools/seed` | Fake ad traffic generator (writes directly to ClickHouse, ~1.5M events over 60 days) |
| `docker-compose.yml` | ClickHouse 24.x, Postgres 16, ingest, dashboard |

### Deviations from the requested stack, and why

1. **Two extra packages (`queries`, `db`)**: keeps SQL and Prisma out of the Next app, so the query layer can be tested on its own and shared with the seed script.
2. **Ingest is a standalone Fastify service, not Next route handlers**: it scales independently from the dashboard, handles ad bursts with a cheap in-memory buffer, and can be served from a first-party subdomain (`e.weartstudio.io`).
3. **Auth is built in (argon2id + DB sessions in Postgres + httpOnly cookie), not Auth.js**: Auth.js's credentials provider does not support database sessions well, and two roles do not need more. About 200 lines, all tested.
4. **No Redis/Kafka for now**: ClickHouse `async_insert` plus an in-process buffer handles thousands of events per second on one node. The buffer interface is written so Kafka/Redpanda can be added later without touching the handlers.
5. **Replay chunks are stored in ClickHouse** (ZSTD, 30-day TTL) rather than S3 for v1, so there is one less moving part locally. The storage interface allows switching to S3/MinIO.

### Key decisions

- **First-party ingest subdomain** (`e.weartstudio.io`, CNAME). The ingest server sets the `wa_id` visitor cookie itself (`Set-Cookie`, `SameSite=Lax`, 13 months). Safari ITP caps cookies set from JS at 7 days, which would break attribution for anyone converting more than a week after the ad click. It also avoids most ad-blocker lists. The SDK also keeps a JS cookie + localStorage copy as fallback.
- **Identity**: `anonymous_id` (UUIDv7) per browser, `session_id` (UUIDv7, rotated after 30 min idle or at a UTM/click-ID change, as GA does), `user_id` after `identify()`. An `identities` table maps anonymous IDs to a `person_id`. Queries resolve `person_id` through a ClickHouse dictionary, so all earlier anonymous history merges with the user automatically, with no rewriting of events.
- **Dedup**: every event has a client-generated `event_id` (UUIDv7). Ingest keeps an LRU of IDs seen in the last 15 minutes (catches retries and beacon double-sends), and `events` is a `ReplacingMergeTree` keyed on `event_id` as a safety net.
- **Time**: the SDK sends `client_ts` plus `sent_at`; ingest computes clock skew and stores the corrected `ts` together with `received_at`.
- **Bots**: the SDK does nothing when `navigator.webdriver` is true or the UA matches the `isbot` list; ingest re-checks the UA and drops (and counts) bot events.
- **Single site now, multi-project ready**: every table has `project_id`; the UI assumes one project, weartstudio.io.

---

## 2. ClickHouse schema

### 2.1 Raw events

```sql
CREATE TABLE events
(
  project_id        LowCardinality(String),
  event_id          UUID,
  event             LowCardinality(String),       -- '$pageview', 'onboarding_step_viewed', ...
  ts                DateTime64(3, 'UTC'),
  received_at       DateTime64(3, 'UTC'),
  anonymous_id      UUID,
  session_id        UUID,
  user_id           String DEFAULT '',            -- set after identify()

  -- page
  url               String,
  path              String,
  host              LowCardinality(String),
  title             String,
  referrer          String,
  referrer_domain   LowCardinality(String),

  -- attribution (last-touch for this session; first-touch lives in `visitors`)
  utm_source        LowCardinality(String),
  utm_medium        LowCardinality(String),
  utm_campaign      String,
  utm_content       String,
  utm_term          String,
  campaign_id       String,                       -- from {{campaign.id}} etc., see §5
  adset_id          String,
  ad_id             String,
  click_id_type     LowCardinality(String),       -- 'fbclid' | 'gclid' | 'ttclid' | 'wbraid' | 'gbraid' | ''
  click_id          String,
  channel           LowCardinality(String),       -- derived: 'paid_social', 'paid_search', 'organic_search', 'direct', ...

  -- device / geo (enriched server-side)
  device_type       LowCardinality(String),       -- desktop | mobile | tablet
  browser           LowCardinality(String),
  browser_version   LowCardinality(String),
  os                LowCardinality(String),
  os_version        LowCardinality(String),
  screen_w          UInt16,
  screen_h          UInt16,
  viewport_w        UInt16,
  viewport_h        UInt16,
  language          LowCardinality(String),
  country           LowCardinality(FixedString(2)),
  region            LowCardinality(String),
  city              String,

  -- flow context (onboarding funnels, see §3)
  flow_id           LowCardinality(String),       -- 'onboarding-3'
  step              UInt8,
  step_name         LowCardinality(String),

  -- typed hot properties (avoid JSON parsing on common queries)
  duration_ms       UInt32,                       -- step duration, field time, page active time
  idle_ms           UInt32,
  element_selector  String,
  element_text      String,                       -- truncated to 64 chars, never from inputs
  x                 UInt16,
  y                 UInt16,
  field_name        LowCardinality(String),       -- form field name/id, never its value
  error_message     String,

  properties        String CODEC(ZSTD(3)),        -- remaining props, JSON; read via JSONExtract*
  sdk_version       LowCardinality(String),
  replay_enabled    UInt8,

  INDEX idx_user user_id TYPE bloom_filter GRANULARITY 4,
  INDEX idx_session session_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, toDate(ts), event, anonymous_id, event_id)
TTL toDateTime(ts) + INTERVAL 395 DAY      -- updated from the retention setting
SETTINGS index_granularity = 8192;
```

Why this sort key: almost every dashboard query filters on date range and event name first; `anonymous_id` next gives good locality for per-visitor funnels and timelines.

### 2.2 Identity

```sql
CREATE TABLE identities
(
  project_id   LowCardinality(String),
  anonymous_id UUID,
  person_id    String,          -- user_id when identified, else anonymous_id as string
  updated_at   DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (project_id, anonymous_id);

CREATE DICTIONARY identity_dict (anonymous_id UUID, person_id String)
PRIMARY KEY anonymous_id
SOURCE(CLICKHOUSE(TABLE 'identities'))
LIFETIME(MIN 30 MAX 60) LAYOUT(HASHED());
-- usage: dictGetOrDefault('identity_dict', 'person_id', anonymous_id, toString(anonymous_id))
```

### 2.3 Materialized views / pre-aggregations

| Table (target) | Engine | Populated by | Serves |
|---|---|---|---|
| `sessions` | AggregatingMergeTree, ORDER BY (project_id, toDate(start), session_id) | MV on `events` | Overview, campaigns, explorer list, bounce rate, duration |
| `visitors` | AggregatingMergeTree, ORDER BY (project_id, anonymous_id) | MV on `events` | First-touch attribution, first-seen cohort, last seen |
| `daily_stats` | AggregatingMergeTree, ORDER BY (project_id, date, channel, utm_source, utm_campaign, adset_id, ad_id, device_type, country) | MV on `events` | Overview KPIs + sparklines, campaign table (all filters are sort-key columns) |
| `flow_steps` | AggregatingMergeTree, ORDER BY (project_id, flow_id, toDate(entered_at), session_id, step) | MV on `events` where `flow_id != ''` | Onboarding funnel, step timing (median/p90), drop-off user lists |
| `form_fields` | AggregatingMergeTree, ORDER BY (project_id, flow_id, step, field_name, date) | MV on `$form_*` events | Field-level abandonment, time per field, validation errors |
| `page_daily` | SummingMergeTree | MV on `$pageview`/`$pageleave` | Active pages, exits, scroll depth, time on page |
| `replay_chunks` | MergeTree, ORDER BY (project_id, session_id, seq), TTL 30 d | written by ingest | Session replay |
| `bot_drops` | SummingMergeTree | ingest | Data-quality panel |

`sessions` columns (aggregate states): `start` minState(ts), `end` maxState(ts), `anonymous_id` any, `user_id` anyLast, `entry_path` argMinState(path, ts), `exit_path` argMaxState(path, ts), `pageviews` countIf, `events` count, attribution fields argMinState(…, ts), `device_type`/`country`/`browser` any, `max_step` maxState(step), `converted` maxState(event = 'onboarding_completed'), `active_ms` sumState(duration_ms on `$pageleave`). Bounce = `pageviews = 1 AND duration < 10 s AND no interaction`.

`visitors`: `first_seen` minState, `last_seen` maxState, `first_touch_*` argMinState over sessions with a non-empty source, `last_touch_*` argMaxState of the same, `sessions` uniqState(session_id).

`flow_steps` per (session, step): `entered_at` minState(ts) on `onboarding_step_viewed`, `completed_at` minState on `onboarding_step_completed`, `duration_ms` maxState, `errors` countIf(`onboarding_step_error`), `rage_clicks`, `last_field` argMaxState(field_name, ts). This turns the preset funnel into a GROUP BY over a few hundred thousand rows instead of a `windowFunnel()` scan over millions. The custom funnel builder uses `windowFunnel()` over raw `events`, limited by date and event-name prefilter.

### 2.4 Retention

The admin setting `retention_days` (default 395) runs `ALTER TABLE … MODIFY TTL` on `events`, `sessions`, `flow_steps`, `form_fields`. Replay has its own setting (default 30 days). Aggregated `daily_stats` contain no visitor IDs and can be kept longer.

---

## 3. Event spec

### 3.1 Auto-captured events (SDK)

| Event | When | Key properties |
|---|---|---|
| `$pageview` | load + every History API / popstate route change | url, path, title, referrer, attribution |
| `$pageleave` | route change, `pagehide`, tab hidden for more than 30 min | `duration_ms` (active, tab visible + input in the last 30 s), `idle_ms`, `scroll_max` |
| `$scroll_depth` | first time 25 / 50 / 75 / 100 % is reached on a page | `depth` |
| `$click` | click on interactive or `[data-wa]` elements | selector, text (≤64 chars, never from inputs), x, y, `href` |
| `$rage_click` | ≥3 clicks within 600 ms in a 30 px radius | selector, count |
| `$dead_click` | click with no DOM mutation, navigation, or network request within 1 s | selector |
| `$form_field_focus` / `$form_field_blur` | per field | `field_name`, `field_type`, `duration_ms`, `filled` (bool), `changed` (bool), `length_bucket` (0, 1-5, 6-20, 21+). **No values**, except fields whitelisted via `data-wa-capture` or config |
| `$form_field_error` | `invalid` event, `aria-invalid="true"`, or manual `weart.fieldError()` | `field_name`, `error_message` (validation message text only) |
| `$form_submit` | form submit | form selector, field count |
| `$form_abandon` | page leave with a started, unsubmitted form | `last_field`, `fields_touched` |
| `$error` | `window.onerror`, `unhandledrejection` | message, source, line, stack (truncated, URL query strings stripped) |
| `$network_error` | fetch/XHR wrapper: status ≥ 400 or failure | method, url (no query string), status, duration_ms |
| `$identify` | `weart.identify()` | user_id, traits (hashed email only) |
| `$consent` | consent granted or revoked | state |

### 3.2 Manual API

```ts
weart.init({ siteId: 'weartstudio', endpoint: 'https://e.weartstudio.io', consent: 'required' | 'not-required',
             replay: { sampleRate: 0.2, maskAllInputs: true }, capture: { allowFields: ['plan_choice'] } })
weart.track(name, props?)
weart.identify(userId, { email_hash, plan })
weart.consent('granted' | 'denied')
weart.reset()                         // logout: new anonymous_id
// flow helper: tracks time per step itself and fires the events from §3.3
const ob = weart.flow('onboarding-3', { version: 'v3' })
ob.step(2, 'style')                   // fires step_viewed; completes previous step if still open
ob.complete(2, { choice: 'minimal' }) // fires step_completed with duration_ms
ob.error(2, 'email', 'invalid_format')
ob.finish({ plan: 'pro' })            // fires onboarding_completed
```

### 3.3 `/onboarding-3` events (placeholder steps: see question 1)

All carry `flow_id = 'onboarding-3'`, `flow_version`, `step`, `step_name`.

| Event | Fire when | Extra props |
|---|---|---|
| `onboarding_started` | step 1 first rendered | `entry` (ad / organic / direct) |
| `onboarding_step_viewed` | each step rendered (including going back) | `is_revisit` |
| `onboarding_step_completed` | user advances past a step | `duration_ms`, `answer` (whitelisted, non-PII enums only) |
| `onboarding_step_error` | validation or API error on a step | `field_name`, `error_code` |
| `onboarding_step_back` | back button | `from_step`, `to_step` |
| `onboarding_completed` | final success | `total_duration_ms`, `plan` |
| `onboarding_abandoned` | sent by the SDK on `pagehide` if the flow is open | `last_step`, `last_field`, `active_ms_on_step` |
| `sign_up` / `purchase` | business conversions | `value`, `currency` (purchase), forwarded to CAPI |

Placeholder step map used for seed data until you confirm the real one:
`1 intro → 2 style → 3 goals → 4 details (form: name, email, phone?) → 5 plan → 6 checkout → completed`.
Steps are **configured in the dashboard settings (Postgres)**, not hard-coded, so renaming or adding steps does not need a deploy.

---

## 4. PostgreSQL (Prisma)

- `User` (email, password_hash argon2id, name, role ADMIN|VIEWER), `AuthSession`
- `Project` (site_id, domain, retention_days, replay_retention_days, consent_mode, allowed_capture_fields, timezone)
- `FlowDefinition` (flow_id, steps JSON: [{step, name, label, fields[]}]), preset funnel source
- `Funnel` (saved custom funnels), `Segment` (name, filter JSON, owner, shared)
- `AdSpend` (date, source, campaign_id/name, adset_id/name, ad_id/name, spend, currency, impressions, clicks, import_batch_id), `AdSpendImport`
- `ShareLink` (token hash, path + filter state, expires_at, created_by), read-only access to one dashboard view
- `ConversionDestination` (type META_CAPI | GOOGLE_ADS, enabled, dry_run, credentials (encrypted), event mapping), `ConversionOutbox` (status, attempts, payload, last_error)

---

## 5. Ad tracking URL templates (recommended)

- **Meta**: `utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}` (+ `fbclid` is added automatically; `utm_source` becomes `instagram` from `{{site_source_name}}` if you want them split)
- **Google**: auto-tagging on (gclid/wbraid/gbraid) + `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&adset_id={adgroupid}&ad_id={creative}`
- **TikTok**: `utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&campaign_id=__CAMPAIGN_ID__&adset_id=__AID__&ad_id=__CID__` (+ `ttclid`)

IDs are the join key with spend CSVs; names are display-only (names change, IDs do not).

---

## 6. Screens

| # | Route | Contents |
|---|---|---|
| – | `/login` | Email + password |
| 1 | `/overview` | 6 KPI tiles (visitors, sessions, bounce, avg duration, conversion rate, onboarding completion) with Δ vs previous period + sparkline; traffic over time by channel; top campaigns; onboarding mini-funnel; top landing pages |
| 2 | `/campaigns` | Expandable tree table source → campaign → ad set → ad; visitors, engaged sessions, onboarding starts, completions, CR, avg time-to-convert, spend, CPA, cost per completion; first/last-touch toggle; CSV spend import drawer |
| 3 | `/funnels`, `/funnels/onboarding-3`, `/funnels/new` | Builder (pages/events, conversion window, breakdown); preset funnel bars with entered / completed / drop-off % / median / p90; clicking a bar opens a drawer listing users who dropped there |
| 4 | `/funnels/onboarding-3/steps/[step]` | Time-on-step histogram, field abandonment table + bar, errors, rage/dead clicks by selector, exit destinations |
| 5 | `/users`, `/users/[personId]` | Searchable, filterable visitor table; vertical journey timeline (ad source → landing → pages/steps/clicks/fields, durations, drop-off in red), sessions list, replay links |
| 6 | `/replay/[sessionId]` | rrweb player, event timeline sidebar (click to seek), skip inactivity, 1/2/4/8×, inactivity shown on the scrubber |
| 7 | `/paths` | ECharts Sankey from a chosen landing page/source, depth 3–6, exits node in red |
| 8 | `/realtime` | Live visitors (last 5 min), live event stream (SSE, 2 s poll of ClickHouse), active pages, live onboarding step counts |
| 9 | `/retention` | Cohort heatmap by first-visit week or campaign; return / onboarding-completion retention |
| 10 | `/events` | Event explorer: event + property filters, breakdown, line/bar/table, interval |
| 11 | `/segments` | Saved segments; any page's filter bar can "Save as segment" |
| 12 | Everywhere | CSV export on every table (server-streamed), "Copy share link" (signed read-only URL) |
| – | `/settings/*` | Project + SDK snippet, onboarding flow steps, ad spend imports, conversion destinations, team & roles, privacy & retention, data quality (bot drops, ingest lag) |

Global top bar: date range (presets + compare toggle), filter chips (campaign, ad set, ad, source, device, country, segment), all stored in the URL so links are shareable. `⌘K`: navigation, user search by user_id/anonymous_id, jump to campaign. Shortcuts: `g o` overview, `g c` campaigns, `g f` funnels, `[` collapse sidebar, `/` focus search.

Design tokens: the palette you specified as CSS variables mapped into Tailwind (`bg`, `surface`, `elevated`, `border`, `primary`, `secondary`, `success`, `warning`, `danger`, `fg`, `fg-muted`, `fg-subtle`), Inter with `font-feature-settings: "tnum"`, JetBrains Mono for IDs and numbers, a shared ECharts theme object.

---

## 7. Privacy

- No field values captured by default; masking for text in `[data-wa-mask]` and all inputs in replay.
- IP is used in memory for geo lookup only and never written. Geo uses DB-IP City Lite (CC BY 4.0, no license key needed) or `CF-IPCountry` when behind Cloudflare.
- `identify()` traits: the SDK rejects plain emails/phones (regex) and only allows hashes (`email_hash` = SHA-256 of the normalized email, which is also what Meta CAPI wants).
- Consent mode `required`: before consent, nothing is stored (no cookie, no localStorage) and nothing is sent; events are held in memory and flushed only if consent is granted on that page. GPC (`navigator.globalPrivacyControl`) is honoured as an opt-out for CCPA.
- Retention TTLs as in §2.4; `DELETE` by person for GDPR erasure requests (admin action).
- `docs/PRIVACY.md` documents all of this.

---

## 8. Seed data

`pnpm seed`: 60 days, about 45k visitors, 60k sessions, 1.5M events. Campaigns across Meta (FB + IG placements), Google, TikTok, plus organic/direct. Each campaign has different quality: e.g. one TikTok campaign with high bounce, one Meta ad set dropping heavily at step 4 on the email field, mobile slower on step 5. Includes rage clicks on the step 5 plan selector, validation errors on email, back-navigation, returning visitors converting days later (so first- vs last-touch differ), identified users, about 300 sessions with synthetic rrweb recordings, and a matching ad spend CSV.

## 9. Testing

- Vitest: SDK (ids/session rotation, attribution parsing, consent gating, batching/retry, rage/dead click detection, form metadata, no values leaking), ingest (validation, dedup, enrichment, bot filter), query layer against a ClickHouse test container (funnel math, medians, first/last touch).
- Playwright: login → overview loads with data; funnel → click a step bar → user list → user timeline; campaigns filter + CSV export; replay plays.
- CI: typecheck, lint, test, SDK size limit (core ≤ 10 KB gz).
- Performance check: a script that times every dashboard API route on seeded data (target p95 < 400 ms per query, page < 1.5 s).

## 10. Milestones

1. SDK + ingest + ClickHouse/Postgres schema + migrations + seed + docker-compose
2. App shell (layout, auth, filters, ⌘K) + Overview + Campaigns (with spend import) + Onboarding funnel
3. User explorer + journey timeline + step drill-down
4. Session replay + Paths (Sankey) + Real-time
5. Cohorts, segments, event explorer, exports/share links, conversion forwarding stubs, polish, README


---

## 11. Extended scope (second brief)

Changes to the stack:

- **`apps/worker`** (BullMQ on **Redis**): conversion forwarding (Meta CAPI, Google Ads enhanced
  conversions, TikTok Events API), remote-config publishing, and later ad-platform imports,
  anomaly detection, alerts and scheduled reports.
- **Object storage (S3 API)** for replays and page snapshots, instead of ClickHouse blobs.
  Local dev uses SeaweedFS, because MinIO images are no longer published.
- Roles are **owner / admin / analyst / viewer**, with invites, multiple projects and an audit log
  (already in the Prisma schema).
- SDK additions: web vitals, in-app browser detection (server-side), page snapshots for heatmaps,
  `getVariant()` (deterministic bucketing, `$exposure`), `revenue()`.

Additional ClickHouse tables (already created): `replay_chunks`, `page_snapshots` (S3 index),
`ingest_stats`. Heatmap aggregates, web-vitals rollups, anomaly baselines and experiment results
are added in their milestones as materialized views on `events`.

| Milestone | Scope |
|---|---|
| 1 ✅ | SDK + ingestion + schema + seed + conversion forwarding (dry-run) |
| 2 | Dashboard shell (auth, filters, ⌘K), Overview, Campaigns (+ CSV spend import, first/last touch), Onboarding funnel |
| 3 | User explorer + journey timeline, step drill-down |
| 4 | Session replay player, Paths (Sankey), Real-time |
| 5 | Cohorts, segments, event explorer, exports, share links, polish |
| 6 | Heatmaps (click/move/scroll over snapshots, per step, segment compare), form analytics, friction score, frustration session finder |
| 7 | Meta / Google / TikTok Ads OAuth imports, full-funnel ad report, creative analytics, click-to-landing loss, multi-touch attribution models, Stripe revenue (LTV, payback, refunds) |
| 8 | Feature flags + experiments (Bayesian + frequentist, SRM), annotations |
| 9 | Anomaly detection, alerts (Telegram/Slack/email), AI insights (LLM gets aggregates only), drop-off prediction |
| 10 | Web vitals reports, error monitoring, user profiles + lifecycle stages, retargeting audiences, custom dashboards (dnd-kit), scheduled reports, public API + webhooks, multi-project workspace, GDPR tools |
