# Integrating the SDK on `/onboarding-3`

This guide makes the onboarding funnel, step drill-down, field-level abandonment and the user
timeline work out of the box. A working reference page is in
[`examples/onboarding-3/index.html`](../examples/onboarding-3/index.html).

> **Step list is a placeholder.** It is `intro → style → goals → details → plan → checkout` until
> the real steps are confirmed. The step list lives in **Settings → Flows** (Postgres
> `FlowDefinition`), so renaming or adding steps only means changing the numbers and names you pass
> to `ob.step()` plus that setting. No dashboard deploy is needed.

## 1. Install

### Option A: npm (recommended for the app that renders onboarding)

```bash
pnpm add @weart/sdk
```

```ts
import { weart } from '@weart/sdk';

weart.init({
  siteId: 'weartstudio',
  endpoint: 'https://e.weartstudio.io',   // first-party ingest subdomain (CNAME)
  consent: 'required',                     // nothing is stored/sent until weart.consent('granted')
  captureFields: ['style_choice', 'goal', 'experience_level', 'plan_choice', 'billing_period'],
});
```

### Option B: script tag (marketing pages)

```html
<script>
  !function(w,n){var q=w[n]=w[n]||function(){(q.q=q.q||[]).push(arguments)};q.q=q.q||[]}(window,'weart');
  weart('init', { siteId: 'weartstudio', endpoint: 'https://e.weartstudio.io', consent: 'required' });
</script>
<script async src="https://e.weartstudio.io/sdk/weart.js"></script>
```

Both options are the same SDK. The core is under 10 KB gzipped and loads async. The replay
recorder (about 23 KB gz) is a separate file that is only downloaded for sampled sessions.

### Consent

Connect your cookie banner / CMP:

```ts
cmp.onAccept(() => weart.consent('granted'));
cmp.onReject(() => weart.consent('denied'));
```

Before consent, events are kept in memory only and are flushed if consent is granted on that
page. Denying removes all identifiers. Global Privacy Control is respected as an opt-out.

## 2. Events per step

Use the flow helper. It times each step, auto-completes the previous step when the user moves
forward, detects back-navigation, and attaches `flow_id/step/step_name` to every auto-captured
event (clicks, field focus/blur, errors) while the user is on a step.

```ts
const ob = weart.flow('onboarding-3', { version: 'v3' });
```

| Step | Call when the step renders | Inside the step | When the user advances |
|---|---|---|---|
| 1 `intro` | `ob.step(1, 'intro')` → also fires `onboarding_started` | (nothing) | handled by next `ob.step()` |
| 2 `style` | `ob.step(2, 'style')` | style cards: add `data-wa="style-<name>"` for readable selectors; hidden input `name="style_choice"` | `ob.step(3, 'goals')` |
| 3 `goals` | `ob.step(3, 'goals')` | selects `name="goal"`, `name="experience_level"` (values whitelisted) | `ob.step(4, 'details')` |
| 4 `details` | `ob.step(4, 'details')` | inputs `first_name`, `email`, `phone`. On validation failure: `ob.error('email', 'invalid_format')` | after account creation: `weart.identify(userId, { email_hash })`, then `weart.track('sign_up', { email_hash })`, `ob.step(5, 'plan')` |
| 5 `plan` | `ob.step(5, 'plan')` | `plan_choice`, `billing_period` (whitelisted); toggle: `data-wa="plan-toggle"` | `ob.step(6, 'checkout')` |
| 6 `checkout` | `ob.step(6, 'checkout')` | card fields are never captured (values are never read; only focus/blur timing) | on payment success: `weart.revenue({ amount, currency, order_id })` then `ob.finish({ plan })` |

Events this produces (all with `flow_id='onboarding-3'`, `step`, `step_name`, `flow_version`):

| Event | Fired by | Key properties |
|---|---|---|
| `onboarding_started` | first `ob.step()` | `first_step` |
| `onboarding_step_viewed` | `ob.step(n)` | `is_revisit` |
| `onboarding_step_completed` | advancing / `ob.complete()` | `duration_ms` (wall clock), `active_ms` |
| `onboarding_step_back` | `ob.step(n)` with a lower `n` | `from_step`, `to_step` |
| `onboarding_step_error` | `ob.error(field, code)` | `field`, `error` |
| `onboarding_completed` | `ob.finish()` | your props (e.g. `plan`) |
| `onboarding_abandoned` | SDK on real page unload while the flow is open | `last_step`, `last_field`, `active_ms_on_step` |
| `purchase` | `weart.revenue()` | `revenue`, `currency`, `order_id` |
| `sign_up` | `weart.track('sign_up', …)` | `email_hash` (SHA-256 of normalized email) |

`onboarding_abandoned` is best effort, because mobile tabs often never fire `pagehide`. The
dashboard also derives drop-off on the server: a session that entered step N and never completed
it counts as dropped at step N, and its last focused field counts as the abandonment field.

### Hashing the email

```ts
const email_hash = await weart.hashEmail(email);   // sha256(trim(lowercase(email)))
weart.identify(user.id, { email_hash, plan: 'free' });
```

`identify()` refuses traits that look like a raw email or phone number. The same hash is used to
match conversions in Meta CAPI, Google Enhanced Conversions and the TikTok Events API.

### SPA routing

If each step changes the URL (`/onboarding-3?step=style`), the SDK records a `$pageview` per step,
so paths and heatmaps can also be split by URL. Changing the route between steps is **not**
counted as abandonment.

### Selectors

Add `data-wa="..."` to important buttons and cards. Click, rage-click and dead-click reports then
show stable names (`[data-wa="ob-continue"]`) instead of CSS paths. Use `data-wa-mask` on any
element whose text must never be recorded (also masked in replays) and `data-wa-block` to exclude
an element from replays entirely.

## 3. Experiments (A/B)

```ts
const variant = await weart.getVariantAsync('ob_style_step_layout'); // 'control' | 'grid' | null
```

Assignment is deterministic per visitor and sticky. An `$exposure` event is fired once per
session, and the variant is attached to all later events of the session, so funnel impact can be
broken down by variant.

## 4. Verify

1. Open `/onboarding-3?utm_source=facebook&utm_medium=paid_social&utm_campaign=test` with
   `debug: true` in `init` to see each event in the console.
2. In the dashboard **Real-time** view, the session should appear within about 5 seconds.
3. `weart.anonymousId` / `weart.sessionId` in the console give IDs to search for in the user explorer.
