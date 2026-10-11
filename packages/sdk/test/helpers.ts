import { Batch } from '@weart/shared';
import { vi } from 'vitest';
import type { Weart } from '../src/index';

export interface Sent {
  url: string;
  body: Batch;
}

/** Fresh SDK instance with mocked transport. */
export async function setup(opts: {
  url?: string;
  referrer?: string;
  consent?: 'required' | 'not-required';
  fetchStatus?: number | 'error';
  config?: unknown;
  captureFields?: string[];
}): Promise<{ weart: Weart; sent: Sent[]; flush: () => void }> {
  vi.resetModules();
  history.replaceState(null, '', opts.url ?? '/onboarding-3');
  Object.defineProperty(document, 'referrer', { value: opts.referrer ?? '', configurable: true });
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/v1/config')) {
        return new Response(JSON.stringify(opts.config ?? { experiments: [], replay_sample_rate: 0, snapshot_sample_rate: 0, capture_fields: [] }));
      }
      if (opts.fetchStatus === 'error') throw new TypeError('network down');
      sent.push({ url: String(url), body: Batch.parse(JSON.parse(String(init?.body))) });
      return new Response(null, { status: opts.fetchStatus ?? 202 });
    }),
  );
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (url: string, data: Blob) => {
      void data.text().then((t) => sent.push({ url, body: Batch.parse(JSON.parse(t)) }));
      return true;
    },
  });
  const { weart } = await import('../src/index');
  weart.init({
    siteId: 'weartstudio',
    endpoint: 'https://e.weartstudio.io',
    consent: opts.consent ?? 'not-required',
    captureFields: opts.captureFields,
    autocapture: { vitals: false },
  });
  const flush = (): void => weart._core()?.flush();
  return { weart, sent, flush };
}

export function clearStorage(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=-1`;
  }
  localStorage.clear();
  sessionStorage.clear();
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const events = (sent: Sent[]): Array<Batch['events'][number] & { ctx: Batch['ctx'] }> =>
  sent.flatMap((s) => s.body.events.map((e) => ({ ...e, ctx: s.body.ctx })));
