/**
 * Script-tag entry. Replays calls queued by the inline snippet:
 *   window.weart = function(){ (weart.q = weart.q || []).push(arguments) }
 *   weart('init', {...}); weart('track', 'x')
 */
import { weart, type Weart } from './index';

type Queued = ArrayLike<unknown>;
type Stub = ((...args: unknown[]) => void) & { q?: Queued[] };

const w = window as unknown as { weart?: Stub | Weart };
const stub = w.weart as Stub | undefined;
const queued = stub && typeof stub === 'function' && Array.isArray(stub.q) ? stub.q : [];

const call = (method: string, ...args: unknown[]): unknown => {
  const fn = (weart as unknown as Record<string, unknown>)[method];
  return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(...args) : undefined;
};

const api = Object.assign((method: string, ...args: unknown[]) => call(method, ...args), weart);
Object.defineProperty(api, 'anonymousId', { get: () => weart.anonymousId });
Object.defineProperty(api, 'sessionId', { get: () => weart.sessionId });
w.weart = api;

// init must run first even if the site queued track() calls before it
const items = Array.from(queued, (q) => Array.from(q));
items.sort((a, b) => (a[0] === 'init' ? -1 : b[0] === 'init' ? 1 : 0));
for (const [method, ...args] of items) call(String(method), ...args);

// Auto-init from data attributes: <script src=".../weart.js" data-site="weartstudio" data-endpoint="...">
const tag = document.currentScript as HTMLScriptElement | null;
if (tag?.dataset.site && !weart.anonymousId) {
  weart.init({
    siteId: tag.dataset.site,
    endpoint: tag.dataset.endpoint ?? new URL(tag.src).origin,
    consent: tag.dataset.consent === 'not-required' ? 'not-required' : 'required',
  });
}
