/**
 * Session replay + page snapshots (lazy bundle, not part of the core size budget).
 * Uses rrweb with ALL inputs masked and [data-wa-mask] text masked/blocked.
 */
import { record } from '@rrweb/record';
import type { Core } from './core';
import { now } from './util';

type RREvent = { type: number; timestamp: number; data?: unknown };

const CHUNK_MS = 10_000;
const CHUNK_MAX_EVENTS = 1000;

export function startReplay(core: Core, opts: { replay: boolean; snapshot: boolean } = { replay: true, snapshot: false }): () => void {
  if (core.consent === 'denied') return () => undefined;
  if (core.consent !== 'granted') {
    // start recording the moment consent is granted
    let stopLater: (() => void) | undefined;
    core.consentHooks.push(() => {
      stopLater = startReplay(core, opts);
    });
    return () => stopLater?.();
  }
  const endpoint = core.opts.endpoint;
  const site = core.opts.siteId;
  let buf: RREvent[] = [];
  let seq = 0;
  let session = core.sessionId;
  let snapshotTaken = false;

  const upload = (beacon: boolean): void => {
    if (!buf.length) return;
    const events = buf;
    buf = [];
    const body = JSON.stringify({
      site,
      anonymous_id: core.anonymousId,
      session_id: session,
      seq: seq++,
      first_ts: events[0]!.timestamp,
      last_ts: events[events.length - 1]!.timestamp,
      events,
    });
    const url = `${endpoint}/v1/replay`;
    if (beacon && body.length < 60_000 && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
    void fetch(url, { method: 'POST', body, keepalive: body.length < 60_000, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined);
  };

  const sendSnapshot = (meta: RREvent, full: RREvent): void => {
    const doc = document.documentElement;
    const step = core.flowCtx ? `${core.flowCtx.flow_id}:${core.flowCtx.step}` : undefined;
    const key = `wa_snap:${location.pathname}:${step ?? ''}:${window.innerWidth < 768 ? 'm' : 'd'}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, String(now()));
    } catch {
      /* ignore */
    }
    void fetch(`${endpoint}/v1/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        site,
        path: location.pathname,
        step_key: step,
        viewport_w: window.innerWidth,
        doc_h: doc.scrollHeight,
        snapshot: [meta, full],
      }),
    }).catch(() => undefined);
  };

  let meta: RREvent | undefined;
  const stop = record({
    emit(e: RREvent) {
      // new session → new recording stream
      const sid = core.sessionId;
      if (sid !== session) {
        upload(false);
        session = sid;
        seq = 0;
      }
      if (e.type === 4) meta = e;
      if (e.type === 2 && meta && opts.snapshot && !snapshotTaken) {
        snapshotTaken = true;
        // wait for late layout (fonts, images) before using it as the heatmap background
        const m = meta;
        setTimeout(() => sendSnapshot(m, e), 0);
        if (!opts.replay) setTimeout(() => stop?.(), 0);
      }
      if (!opts.replay) return;
      buf.push(e);
      if (buf.length >= CHUNK_MAX_EVENTS) upload(false);
    },
    maskAllInputs: true,
    maskTextSelector: '[data-wa-mask]',
    blockSelector: '[data-wa-block]',
    sampling: { mousemove: 50, scroll: 150, input: 'last' },
    recordCanvas: false,
    collectFonts: false,
    inlineStylesheet: true,
  });

  const timer = opts.replay ? setInterval(() => upload(false), CHUNK_MS) : undefined;
  core.leaveHooks.push(() => upload(true));
  return () => {
    stop?.();
    if (timer) clearInterval(timer);
    upload(true);
  };
}

// Script-tag bundle registers itself for the core loader.
if (typeof window !== 'undefined') {
  (window as unknown as { __weartReplay?: typeof startReplay }).__weartReplay = startReplay;
}
