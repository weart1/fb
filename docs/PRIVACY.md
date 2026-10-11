# Privacy and data handling

## What is collected

| Data | Stored? | Notes |
|---|---|---|
| Anonymous visitor id, session id | yes | random UUIDv7. Cookie `wa_id` (400 days) + localStorage fallback, and only after consent when `consent: 'required'` |
| Page URLs, titles, referrers | yes | query params named like `email`, `phone`, `token`, `name`, `password`, `code` … are replaced with `[redacted]` in the SDK |
| UTM parameters, ad IDs, click IDs | yes | needed for attribution and conversion forwarding |
| Clicks | yes | CSS selector, up to 64 chars of the visible label of buttons/links (never from inputs, never inside `data-wa-mask`), coordinates |
| Form interactions | metadata only | field name, focus/blur timing, hesitation, filled yes/no, length bucket (`0`, `1-5`, `6-20`, `21+`). **Values are never read into events.** Exception: fields whitelisted in Settings (non-PII enums such as `plan_choice`); `email`, `tel`, `password` and `number` inputs can never be whitelisted |
| Validation messages | yes | text of the validation message (truncated to 120 chars) |
| JS errors, failed requests | yes | message, stack (truncated), URL **without query string** |
| Device / browser / OS / language / screen | yes | parsed from the User-Agent on the server |
| IP address | **no** | used in memory for the geo lookup (country, region, city), then discarded. Not written to ClickHouse, Postgres, logs or object storage. It is optionally added to conversion-forwarding jobs (`FORWARD_CLIENT_IP=true`, off by default) and those jobs are deleted from Redis after processing |
| Email / phone | hashed only | `identify()` rejects traits that look like raw emails/phones; send `email_hash` (SHA-256) |
| Session replay | sampled, masked | all inputs are masked by rrweb (`maskAllInputs`). `data-wa-mask` masks text and `data-wa-block` excludes elements. Chunks are stored gzipped in object storage and are deleted after `replayRetentionDays` (default 30) |

## Consent

- `consent: 'required'` (default): before `weart.consent('granted')`, nothing is written to
  cookies or localStorage and nothing is sent. Events stay in memory and are discarded if
  consent never comes.
- `weart.consent('denied')` deletes all SDK identifiers. Only the opt-out itself is remembered
  (`wa_consent=denied`), as a strictly necessary cookie.
- Global Privacy Control (`navigator.globalPrivacyControl`) is honoured as an opt-out (CCPA
  "do not sell/share") unless `respectGPC: false`.

## Bots

The SDK does not run when `navigator.webdriver` is set or the User-Agent matches known
crawlers/headless browsers. Ingest re-checks every request and counts dropped bot events in
`ingest_stats`.

## Retention

| Data | Default | Where |
|---|---|---|
| Raw events and per-session pre-aggregations | 395 days | ClickHouse TTL on `events`, `sessions`, `flow_steps`, `form_fields` |
| Replays | 30 days | ClickHouse TTL on `replay_chunks` + object-storage lifecycle |
| Page snapshots (heatmap backgrounds) | 180 days | `page_snapshots` |
| Ingest health counters | 90 days | `ingest_stats` |

Retention is configurable per project in Settings. Changing it updates the ClickHouse TTLs (milestone 5).

## GDPR / CCPA requests

Deleting and exporting a user's data by `user_id` / `anonymous_id` is part of milestone 10
(Settings → Privacy). Until then:

```sql
ALTER TABLE events DELETE WHERE anonymous_id IN (SELECT anonymous_id FROM identities WHERE user_id = {uid:String}) OR user_id = {uid:String};
```
