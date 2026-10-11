/**
 * First-party persistence: cookie first (shared across subdomains/tabs), localStorage as fallback.
 * Before consent, `enabled` is false and nothing is written; values live in memory only.
 */
export class Store {
  enabled = false;
  private mem = new Map<string, string>();
  private domain: string | undefined;

  constructor(cookieDomain?: string) {
    this.domain = cookieDomain;
  }

  get(key: string): string | undefined {
    const m = this.mem.get(key);
    if (m !== undefined) return m;
    const c = readCookie(key);
    if (c !== undefined) return c;
    try {
      return localStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: string, maxAgeDays?: number): void {
    this.mem.set(key, value);
    if (!this.enabled) return;
    writeCookie(key, value, maxAgeDays, this.domain ?? (this.domain = topDomain()));
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked */
    }
  }

  remove(key: string): void {
    this.mem.delete(key);
    writeCookie(key, '', -1, this.domain ?? topDomain());
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /** localStorage-only (large values such as the retry queue). */
  getLocal(key: string): string | undefined {
    try {
      return localStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  setLocal(key: string, value: string | undefined): void {
    if (!this.enabled) return;
    try {
      if (value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* quota */
    }
  }

  /** Persist everything collected in memory before consent was granted. */
  persistMemory(): void {
    for (const [k, v] of this.mem) this.set(k, v, k === 'wa_s' ? undefined : 400);
  }
}

function readCookie(key: string): string | undefined {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
    return m ? decodeURIComponent(m[1]!) : undefined;
  } catch {
    return undefined;
  }
}

function writeCookie(key: string, value: string, maxAgeDays: number | undefined, domain: string): void {
  try {
    let c = `${key}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
    if (maxAgeDays !== undefined) c += `; max-age=${Math.round(maxAgeDays * 86400)}`;
    if (domain) c += `; domain=${domain}`;
    if (location.protocol === 'https:') c += '; Secure';
    document.cookie = c;
  } catch {
    /* ignore */
  }
}

/** Find the registrable domain by setting a probe cookie on progressively longer suffixes. */
function topDomain(): string {
  const parts = location.hostname.split('.');
  if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1]!)) return '';
  for (let i = parts.length - 2; i >= 0; i--) {
    const d = parts.slice(i).join('.');
    document.cookie = `wa_probe=1; path=/; domain=${d}`;
    if (document.cookie.includes('wa_probe=1')) {
      document.cookie = `wa_probe=; path=/; domain=${d}; max-age=-1`;
      return `.${d}`;
    }
  }
  return '';
}
