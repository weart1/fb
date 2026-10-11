import { captureClicks } from './capture/clicks';
import { captureErrors } from './capture/errors';
import { captureForms, fieldError } from './capture/forms';
import { capturePageviews } from './capture/pageviews';
import { captureScroll } from './capture/scroll';
import { captureVitals } from './capture/vitals';
import { Core, SDK_VERSION } from './core';
import { Flow } from './flow';
import type { Props, WeartOptions } from './types';

export type { Props, WeartOptions };
export { Flow };

export interface RevenueInput {
  amount: number;
  currency: string;
  order_id?: string;
  [key: string]: string | number | boolean | null | undefined;
}

/** Public API. Safe to call before init (calls are no-ops) and in non-browser environments. */
export interface Weart {
  version: string;
  init(options: WeartOptions): void;
  track(event: string, props?: Props): void;
  identify(userId: string, traits?: Props): void;
  revenue(r: RevenueInput): void;
  consent(state: 'granted' | 'denied'): void;
  reset(): void;
  flow(id: string, opts?: { version?: string }): Flow;
  fieldError(field: string, error: string): void;
  getVariant(experimentKey: string): string | null;
  /** Resolves after remote config is loaded, so assignments are available. */
  getVariantAsync(experimentKey: string): Promise<string | null>;
  ready(cb: () => void): void;
  hashEmail(email: string): Promise<string>;
  readonly anonymousId: string | undefined;
  readonly sessionId: string | undefined;
  /** internal, used by the replay bundle */
  _core(): Core | undefined;
}

let core: Core | undefined;
const flows = new Map<string, Flow>();
const readyCbs: Array<() => void> = [];

function init(options: WeartOptions): void {
  if (core || typeof window === 'undefined') return;
  core = new Core(options);
  const c = core;
  const a = { pageviews: true, clicks: true, scroll: true, forms: true, errors: true, network: true, vitals: true, ...options.autocapture };
  const scrollMax = a.scroll ? captureScroll(c) : () => 0;
  if (a.clicks) captureClicks(c);
  if (a.forms) captureForms(c);
  if (a.errors) captureErrors(c, a.network);
  if (a.vitals) captureVitals(c);
  if (a.pageviews) capturePageviews(c, scrollMax)();

  c.onConfig(() => {
    const replay = c.decideReplay();
    const snap = Math.random() < (c.config?.snapshot_sample_rate ?? 0);
    if ((replay || snap) && c.consent !== 'denied' && typeof document !== 'undefined') {
      const w = window as unknown as { __weartReplay?: (core: Core, o: { replay: boolean; snapshot: boolean }) => void };
      const start = (): void => w.__weartReplay?.(c, { replay, snapshot: snap });
      if (w.__weartReplay) start();
      else {
        const s = document.createElement('script');
        s.async = true;
        s.src = options.replay?.src ?? `${c.opts.endpoint}/sdk/weart-replay.js`;
        s.onload = start;
        document.head.appendChild(s);
      }
    }
  });
  for (const cb of readyCbs.splice(0)) cb();
}

export const weart: Weart = {
  version: SDK_VERSION,
  init,
  track: (event, props) => core?.track(event, props),
  identify: (userId, traits) => core?.identify(userId, traits),
  revenue: ({ amount, currency, order_id, ...rest }) => {
    const props: Props = { revenue: amount, currency: currency.toUpperCase() };
    if (order_id) props.order_id = order_id;
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) props[k] = v;
    core?.track('purchase', props);
  },
  consent: (state) => core?.setConsent(state),
  reset: () => {
    flows.clear();
    core?.reset();
  },
  flow: (id, opts) => {
    if (!core) throw new Error('weart.flow() called before weart.init()');
    let f = flows.get(id);
    if (!f) flows.set(id, (f = new Flow(core, id, opts?.version)));
    return f;
  },
  fieldError: (field, error) => core && fieldError(core, field, error),
  getVariant: (key) => core?.getVariant(key) ?? null,
  getVariantAsync: (key) =>
    new Promise((resolve) => {
      const go = (): void => (core ? core.onConfig(() => resolve(core!.getVariant(key))) : resolve(null));
      if (core) go();
      else readyCbs.push(go);
    }),
  ready: (cb) => (core ? cb() : readyCbs.push(cb)),
  hashEmail: async (email) => {
    const data = new TextEncoder().encode(email.trim().toLowerCase());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  },
  get anonymousId() {
    return core?.anonymousId;
  },
  get sessionId() {
    return core?.sessionId;
  },
  _core: () => core,
};

export default weart;
