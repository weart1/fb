import type { BatchContext, Props, RemoteConfig, Touch, WireEvent } from '@weart/shared';

export type { BatchContext, Props, RemoteConfig, Touch, WireEvent };

export type ConsentMode = 'required' | 'not-required';
export type ConsentState = 'pending' | 'granted' | 'denied';

export interface WeartOptions {
  /** Site id configured in the dashboard, e.g. "weartstudio" */
  siteId: string;
  /** Ingest origin, ideally a first-party subdomain, e.g. "https://e.weartstudio.io" */
  endpoint: string;
  /** 'required' (default): nothing is stored or sent until consent('granted') */
  consent?: ConsentMode;
  /** Treat Global Privacy Control as an opt-out. Default true. */
  respectGPC?: boolean;
  /** Cookie domain, e.g. ".weartstudio.io". Default: auto-detected top-level domain. */
  cookieDomain?: string;
  /** Session inactivity timeout. Default 30 min. */
  sessionTimeoutMs?: number;
  /** Autocapture toggles; all on by default. */
  autocapture?: Partial<Record<'pageviews' | 'clicks' | 'scroll' | 'forms' | 'errors' | 'network' | 'vitals', boolean>>;
  /** Form fields whose value may be sent (non-PII enums only). Also: data-wa-capture attribute. */
  captureFields?: string[];
  /** Session replay. Sample rate overrides remote config. */
  replay?: { enabled?: boolean; sampleRate?: number; src?: string };
  /** Flush interval (ms) and size. Defaults 5000 / 20. */
  flushIntervalMs?: number;
  flushSize?: number;
  /** Log to console */
  debug?: boolean;
}

export interface EventInput {
  name: string;
  props?: Props | undefined;
}
