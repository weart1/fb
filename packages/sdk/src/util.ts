export const now = (): number => Date.now();

/** RFC 9562 UUIDv7: 48-bit ms timestamp + random. Sortable, and ClickHouse can read the time back. */
export function uuidv7(ts: number = now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ts / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  let h = '';
  for (let i = 0; i < 16; i++) {
    h += b[i]!.toString(16).padStart(2, '0');
    if (i === 3 || i === 5 || i === 7 || i === 9) h += '-';
  }
  return h;
}

export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const trunc = (s: string | null | undefined, n: number): string => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > n ? v.slice(0, n) : v;
};

/** Strip query string and hash from a URL (used for errors and network URLs that may contain tokens). */
export function stripQuery(u: string): string {
  const i = u.search(/[?#]/);
  return i === -1 ? u : u.slice(0, i);
}

const SENSITIVE_PARAMS = /^(email|e-mail|mail|phone|tel|token|access_token|auth|code|password|pass|key|secret|session|sid|name|first_name|last_name)$/i;

/** Remove query params that may carry PII or secrets from page URLs before sending. */
export function cleanUrl(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (SENSITIVE_PARAMS.test(k)) url.searchParams.set(k, '[redacted]');
    url.hash = url.hash.length > 64 ? '' : url.hash;
    return url.toString();
  } catch {
    return stripQuery(u);
  }
}

export function on<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  fn: (e: WindowEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): void;
export function on<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  fn: (e: DocumentEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): void;
export function on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
  target.addEventListener(type, fn, { capture: true, passive: true, ...opts });
}

const BOT_UA = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|facebookexternalhit|meta-externalagent|adsbot|mediapartners|prerender/i;

export function isBot(): boolean {
  const n = navigator as Navigator & { webdriver?: boolean };
  return !!n.webdriver || BOT_UA.test(n.userAgent);
}
