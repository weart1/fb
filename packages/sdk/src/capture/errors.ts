import type { Core } from '../core';
import { now, on, stripQuery, trunc } from '../util';

const MAX_PER_PAGE = 25;

/** JS errors, unhandled rejections, resource load failures, and failed fetch/XHR requests. */
export function captureErrors(core: Core, network: boolean): void {
  const seen = new Set<string>();
  let count = 0;
  core.leaveHooks.push((reason) => {
    if (reason !== 'hidden') {
      seen.clear();
      count = 0;
    }
  });
  const report = (name: '$error' | '$network_error', key: string, props: Record<string, string | number>): void => {
    if (seen.has(key) || count >= MAX_PER_PAGE) return;
    seen.add(key);
    count++;
    core.track(name, props);
  };

  on(window, 'error', (e: ErrorEvent | Event) => {
    if (e instanceof ErrorEvent) {
      const msg = trunc(e.message, 300);
      report('$error', msg, {
        error: msg,
        source: stripQuery(e.filename || '').slice(0, 300),
        line: e.lineno || 0,
        col: e.colno || 0,
        stack: trunc(e.error instanceof Error ? e.error.stack : '', 1000),
        kind: 'error',
      });
    } else if (e.target instanceof Element) {
      const el = e.target as HTMLImageElement | HTMLScriptElement | HTMLLinkElement;
      const src = stripQuery(('src' in el && el.src) || ('href' in el && el.href) || '').slice(0, 300);
      report('$error', `res:${src}`, { error: `Failed to load ${el.tagName.toLowerCase()}`, source: src, kind: 'resource' });
    }
  });
  on(window, 'unhandledrejection', (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason;
    const msg = trunc(r instanceof Error ? r.message : String(r), 300);
    report('$error', `rej:${msg}`, { error: msg, stack: trunc(r instanceof Error ? r.stack : '', 1000), kind: 'unhandledrejection' });
  });

  if (!network) return;
  const own = core.opts.endpoint;
  const failed = (method: string, url: string, status: number, start: number): void => {
    if (url.startsWith(own)) return;
    const u = stripQuery(url).slice(0, 300);
    report('$network_error', `${method}:${u}:${status}`, { method, url: u, status, duration_ms: now() - start });
  };

  const origFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const start = (core.lastNetwork = now());
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return origFetch.call(window, input, init).then(
      (res) => {
        if (res.status >= 400) failed(method, url, res.status, start);
        return res;
      },
      (err: unknown) => {
        failed(method, url, 0, start);
        throw err;
      },
    );
  };

  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;
  XHR.open = function (this: XMLHttpRequest & { __wa?: [string, string] }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__wa = [method.toUpperCase(), String(url)];
    return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;
  XHR.send = function (this: XMLHttpRequest & { __wa?: [string, string] }, body?: Document | XMLHttpRequestBodyInit | null) {
    const start = (core.lastNetwork = now());
    const meta = this.__wa;
    if (meta) this.addEventListener('loadend', () => (this.status === 0 || this.status >= 400) && failed(meta[0], meta[1], this.status, start));
    return origSend.call(this, body);
  };
}
