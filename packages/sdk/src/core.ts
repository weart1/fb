import { Activity } from './activity';
import { LAST_TOUCH_LOOKBACK_MS, isCampaign, parseTouch, sameTouch } from './attribution';
import { Store } from './storage';
import type { BatchContext, ConsentState, Props, RemoteConfig, Touch, WeartOptions, WireEvent } from './types';
import { cleanUrl, fnv1a, isBot, now, on, trunc, uuidv7 } from './util';

export const SDK_VERSION = '0.1.0';
const DAY = 86400_000;
const MAX_PENDING = 200;
const MAX_RETRY_BATCHES = 30;
const PII_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PII_PHONE = /^\+?[\d\s().-]{7,}$/;

interface SessionState {
  id: string;
  start: number;
  last: number;
  touch?: Touch | undefined;
  /** replay sampled for this session */
  r?: 0 | 1;
}

interface FlowCtx {
  flow_id: string;
  step: number;
  step_name: string;
}

type Batch = { site: string; sdk: string; sent_at: number; ctx: BatchContext; events: WireEvent[] };
/** hidden: tab hidden (may come back) · route: SPA navigation · unload: page is going away */
export type LeaveReason = 'hidden' | 'route' | 'unload';
type Hook = (reason: LeaveReason) => void;

/**
 * The SDK runtime. Capture modules call `track`; this class owns identity, sessions,
 * attribution, consent gating, batching, delivery and retries.
 */
export class Core {
  readonly opts: Required<Pick<WeartOptions, 'siteId' | 'endpoint' | 'sessionTimeoutMs' | 'flushIntervalMs' | 'flushSize'>> & WeartOptions;
  readonly store: Store;
  readonly activity: Activity;
  consent: ConsentState = 'pending';
  config: RemoteConfig | undefined;
  /** Set by modules: current flow step attached to every event */
  flowCtx: FlowCtx | undefined;
  /** Last focused form field (forms module) */
  lastField = '';
  /** Timestamp of the last network request start (dead-click detection) */
  lastNetwork = 0;
  /** Called when the tab is hidden, on SPA route changes, and on unload */
  readonly leaveHooks: Hook[] = [];
  readonly sessionHooks: Array<(sessionId: string) => void> = [];
  readonly consentHooks: Array<() => void> = [];
  pageviewId = '';

  private anonId: string;
  private userId: string | undefined;
  private session: SessionState | undefined;
  private queue: WireEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 2000;
  private sessionWrittenAt = 0;
  private exposures: Record<string, string> = {};
  private readonly disabled: boolean;

  constructor(options: WeartOptions) {
    this.opts = {
      sessionTimeoutMs: 30 * 60_000,
      flushIntervalMs: 5000,
      flushSize: 20,
      ...options,
      endpoint: options.endpoint.replace(/\/$/, ''),
    };
    this.store = new Store(options.cookieDomain);
    this.disabled = isBot();

    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
    const stored = this.store.get('wa_consent');
    if (this.opts.respectGPC !== false && gpc) this.consent = 'denied';
    else if (stored === 'granted' || stored === 'denied') this.consent = stored;
    else this.consent = this.opts.consent === 'not-required' ? 'granted' : 'pending';
    this.store.enabled = this.consent === 'granted';

    this.anonId = this.store.get('wa_id') ?? uuidv7();
    this.userId = this.store.get('wa_uid');
    if (this.store.enabled) this.store.set('wa_id', this.anonId, 400);

    this.activity = new Activity(
      () => {
        for (const h of this.leaveHooks) h('hidden');
        this.flush(true);
      },
      () => this.touchSession(),
    );
    on(window, 'pagehide', () => {
      for (const h of this.leaveHooks) h('unload');
      this.flush(true);
    });
    on(window, 'online', () => this.retry());

    this.initAttribution();
    this.retry();
    void this.loadConfig();
  }

  // ---------------------------------------------------------------- identity & session

  get anonymousId(): string {
    return this.anonId;
  }

  get sessionId(): string {
    return this.touchSession().id;
  }

  /** Decide once per session whether it is recorded (needs remote config for the default rate). */
  decideReplay(): boolean {
    const s = this.touchSession();
    if (s.r === undefined) {
      const rate = this.opts.replay?.sampleRate ?? this.config?.replay_sample_rate ?? 0;
      s.r = this.opts.replay?.enabled !== false && Math.random() < rate ? 1 : 0;
      this.store.set('wa_s', JSON.stringify(s));
    }
    return s.r === 1;
  }

  private loadSession(): SessionState | undefined {
    if (this.session) return this.session;
    const raw = this.store.get('wa_s');
    if (!raw) return undefined;
    try {
      return (this.session = JSON.parse(raw) as SessionState);
    } catch {
      return undefined;
    }
  }

  private landingTouch: Touch | undefined;

  private initAttribution(): void {
    this.landingTouch = parseTouch(location.href, document.referrer);
    const s = this.loadSession();
    // A new ad click (different campaign / click id) always starts a new session.
    if (s && isCampaign(this.landingTouch) && !sameTouch(s.touch, this.landingTouch)) this.rotate();
    this.touchSession();
  }

  /** Returns the live session, rotating it after inactivity. Updates last-activity time. */
  touchSession(t: number = now()): SessionState {
    let s = this.loadSession();
    if (!s || t - s.last > this.opts.sessionTimeoutMs) s = this.newSession(t);
    s.last = t;
    if (t - this.sessionWrittenAt > 5000) {
      this.sessionWrittenAt = t;
      this.store.set('wa_s', JSON.stringify(s));
    }
    return s;
  }

  private rotate(): void {
    this.flush();
    this.session = undefined;
    this.store.remove('wa_s');
  }

  private newSession(t: number): SessionState {
    if (this.session) this.flush();
    const landing = this.landingTouch;
    this.landingTouch = undefined; // only the first session of this page view gets the landing touch
    let touch = landing;
    if (landing) this.store.set('wa_lt', JSON.stringify(landing), 30);
    else {
      // direct visit: inherit the last non-direct touch within the lookback window (GA-style)
      const lt = this.readTouch('wa_lt');
      if (lt && t - lt.ts < LAST_TOUCH_LOOKBACK_MS) touch = lt;
    }
    if (!this.store.get('wa_ft')) this.store.set('wa_ft', JSON.stringify(landing ?? { ts: t }), 400);
    const s: SessionState = { id: uuidv7(t), start: t, last: t, touch };
    this.session = s;
    this.sessionWrittenAt = 0;
    this.exposures = {};
    for (const h of this.sessionHooks) h(s.id);
    return s;
  }

  private readTouch(key: string): Touch | undefined {
    const raw = this.store.get(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Touch;
    } catch {
      return undefined;
    }
  }

  identify(userId: string, traits?: Props): void {
    if (!userId) return;
    const clean: Props = {};
    for (const [k, v] of Object.entries(traits ?? {})) {
      if (typeof v === 'string' && (PII_EMAIL.test(v) || PII_PHONE.test(v))) {
        this.log(`identify: dropped trait "${k}" (looks like raw PII; send a hash instead)`);
        continue;
      }
      clean[k] = v;
    }
    if (this.userId !== userId) this.flush();
    this.userId = userId.slice(0, 128);
    this.store.set('wa_uid', this.userId, 400);
    this.track('$identify', clean);
  }

  reset(): void {
    this.flush();
    this.userId = undefined;
    this.store.remove('wa_uid');
    this.anonId = uuidv7();
    this.store.set('wa_id', this.anonId, 400);
    this.rotate();
  }

  // ---------------------------------------------------------------- consent

  setConsent(state: 'granted' | 'denied'): void {
    if (state === this.consent) return;
    this.consent = state;
    if (state === 'granted') {
      this.store.enabled = true;
      this.store.persistMemory();
      this.store.set('wa_id', this.anonId, 400);
      this.store.set('wa_consent', 'granted', 365);
      this.track('$consent', { state });
      this.flush();
      for (const h of this.consentHooks.splice(0)) h();
    } else {
      this.queue = [];
      for (const k of ['wa_id', 'wa_s', 'wa_uid', 'wa_ft', 'wa_lt', 'wa_x']) this.store.remove(k);
      this.store.setLocal('wa_q', undefined);
      this.store.enabled = true; // the opt-out itself is a strictly necessary cookie
      this.store.set('wa_consent', 'denied', 365);
      this.store.enabled = false;
    }
  }

  // ---------------------------------------------------------------- tracking

  track(name: string, props?: Props, at: number = now()): void {
    if (this.disabled || this.consent === 'denied') return;
    this.touchSession(at);
    const p: Props = { ...props };
    if (this.flowCtx && p.flow_id === undefined) Object.assign(p, this.flowCtx);
    if (this.pageviewId && p.pv_id === undefined) p.pv_id = this.pageviewId;
    const ev: WireEvent = {
      id: uuidv7(at),
      name: trunc(name, 128),
      ts: at,
      url: cleanUrl(location.href).slice(0, 2048),
      title: trunc(document.title, 512),
      props: p,
    };
    if (name === '$pageview' && document.referrer) ev.referrer = cleanUrl(document.referrer).slice(0, 2048);
    this.queue.push(ev);
    if (this.queue.length > MAX_PENDING) this.queue.shift();
    this.log(name, p);
    if (this.consent !== 'granted') return;
    if (this.queue.length >= this.opts.flushSize) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.opts.flushIntervalMs);
  }

  private context(): BatchContext {
    const s = this.touchSession();
    const ctx: BatchContext = {
      anonymous_id: this.anonId,
      session_id: s.id,
      session_start: s.start,
      screen_w: screen.width | 0,
      screen_h: screen.height | 0,
      viewport_w: window.innerWidth | 0,
      viewport_h: window.innerHeight | 0,
      language: (navigator.language || '').slice(0, 35),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      replay: s.r === 1,
    };
    if (this.userId) ctx.user_id = this.userId;
    if (s.touch) ctx.touch = s.touch;
    const ft = this.readTouch('wa_ft');
    if (ft) ctx.first_touch = ft;
    if (Object.keys(this.exposures).length) ctx.experiments = { ...this.exposures };
    return ctx;
  }

  flush(beacon = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.consent !== 'granted' || this.disabled || this.queue.length === 0) return;
    const events = this.queue.splice(0, this.queue.length);
    const batch: Batch = { site: this.opts.siteId, sdk: SDK_VERSION, sent_at: now(), ctx: this.context(), events };
    this.send(batch, beacon);
  }

  private send(batch: Batch, beacon: boolean): void {
    const url = `${this.opts.endpoint}/v1/batch`;
    const body = JSON.stringify(batch);
    // text/plain keeps this a CORS "simple request": no preflight round-trip on every flush.
    if (beacon && typeof navigator.sendBeacon === 'function' && body.length < 60_000) {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
    }
    fetch(url, {
      method: 'POST',
      body,
      keepalive: body.length < 60_000,
      credentials: 'include',
      headers: { 'Content-Type': 'text/plain' },
    }).then(
      (r) => {
        if (r.status >= 500 || r.status === 429) this.saveForRetry(batch);
        else this.retryDelay = 2000;
      },
      () => this.saveForRetry(batch),
    );
  }

  // ---------------------------------------------------------------- offline retry queue

  private saveForRetry(batch: Batch): void {
    const pending = this.pendingBatches();
    pending.push(batch);
    this.store.setLocal('wa_q', JSON.stringify(pending.slice(-MAX_RETRY_BATCHES)));
    this.scheduleRetry();
  }

  private pendingBatches(): Batch[] {
    try {
      return JSON.parse(this.store.getLocal('wa_q') ?? '[]') as Batch[];
    } catch {
      return [];
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retry();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 300_000);
  }

  retry(): void {
    if (this.consent !== 'granted' || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) return;
    const pending = this.pendingBatches();
    if (!pending.length) return;
    this.store.setLocal('wa_q', undefined);
    // Drop batches older than 7 days; the server would reject their timestamps anyway.
    for (const b of pending) if (now() - b.sent_at < 7 * DAY) this.send({ ...b, sent_at: now() }, false);
  }

  // ---------------------------------------------------------------- remote config & experiments

  private async loadConfig(): Promise<void> {
    const cached = this.store.getLocal('wa_cfg');
    if (cached) {
      try {
        const c = JSON.parse(cached) as { at: number; cfg: RemoteConfig };
        this.config = c.cfg;
        if (now() - c.at < 10 * 60_000) return this.configReady();
      } catch {
        /* refetch */
      }
    }
    try {
      const r = await fetch(`${this.opts.endpoint}/v1/config?site=${encodeURIComponent(this.opts.siteId)}`);
      if (r.ok) {
        this.config = (await r.json()) as RemoteConfig;
        this.store.setLocal('wa_cfg', JSON.stringify({ at: now(), cfg: this.config }));
      }
    } catch {
      /* offline: keep cached */
    }
    this.configReady();
  }

  private configWaiters: Array<() => void> = [];
  private configLoaded = false;

  private configReady(): void {
    this.configLoaded = true;
    for (const w of this.configWaiters.splice(0)) w();
  }

  onConfig(cb: () => void): void {
    if (this.configLoaded) cb();
    else this.configWaiters.push(cb);
  }

  /** Deterministic, sticky variant assignment. Returns null when not in the experiment. */
  getVariant(key: string): string | null {
    const exp = this.config?.experiments.find((e) => e.key === key);
    if (!exp) return null;
    let assigned: Record<string, string> = {};
    try {
      assigned = JSON.parse(this.store.get('wa_x') ?? '{}') as Record<string, string>;
    } catch {
      /* reset */
    }
    let v = assigned[key];
    if (v === undefined) {
      const inTraffic = fnv1a(`${key}:${this.anonId}`) / 0x100000000 < exp.traffic;
      v = '';
      if (inTraffic) {
        const total = exp.variants.reduce((a, b) => a + b.weight, 0) || 1;
        let x = (fnv1a(`${key}:variant:${this.anonId}`) / 0x100000000) * total;
        for (const variant of exp.variants) {
          x -= variant.weight;
          if (x < 0) {
            v = variant.key;
            break;
          }
        }
        v ||= exp.variants[exp.variants.length - 1]!.key;
      }
      assigned[key] = v;
      this.store.set('wa_x', JSON.stringify(assigned), 400);
    }
    if (!v) return null;
    if (this.exposures[key] !== v) {
      this.exposures[key] = v;
      this.track('$exposure', { experiment: key, variant: v });
    }
    return v;
  }

  log(...args: unknown[]): void {
    if (this.opts.debug) console.debug('[weart]', ...args);
  }
}
