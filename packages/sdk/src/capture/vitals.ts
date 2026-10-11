import type { Core } from '../core';

/**
 * Core Web Vitals from real users (LCP, INP, CLS, TTFB, FCP) for the initial page load,
 * reported once when the page is first hidden. Lightweight re-implementation of the
 * web-vitals library logic (no dependency, keeps the core bundle small).
 */
export function captureVitals(core: Core): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const v: Record<string, number> = {};
  let sent = false;

  const observe = (type: string, cb: (entries: PerformanceEntry[]) => void, extra?: Record<string, unknown>): void => {
    try {
      new PerformanceObserver((l) => cb(l.getEntries())).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      /* unsupported entry type */
    }
  };

  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav) v.TTFB = Math.max(0, nav.responseStart - ((nav as PerformanceNavigationTiming & { activationStart?: number }).activationStart ?? 0));

  observe('paint', (es) => {
    for (const e of es) if (e.name === 'first-contentful-paint') v.FCP = e.startTime;
  });
  observe('largest-contentful-paint', (es) => {
    const last = es[es.length - 1];
    if (last) v.LCP = last.startTime;
  });

  // CLS: largest session window (gap < 1s, window < 5s)
  let cls = 0;
  let win = 0;
  let winStart = 0;
  let winLast = 0;
  observe('layout-shift', (es) => {
    for (const e of es as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
      if (e.hadRecentInput) continue;
      if (win && e.startTime - winLast < 1000 && e.startTime - winStart < 5000) win += e.value;
      else {
        win = e.value;
        winStart = e.startTime;
      }
      winLast = e.startTime;
      cls = Math.max(cls, win);
      v.CLS = cls;
    }
  });

  // INP: worst interaction latency (p98 approximated by max for typical page interaction counts)
  observe(
    'event',
    (es) => {
      for (const e of es as Array<PerformanceEntry & { interactionId?: number }>) {
        if (e.interactionId) v.INP = Math.max(v.INP ?? 0, e.duration);
      }
    },
    { durationThreshold: 16 },
  );

  core.leaveHooks.push(() => {
    if (sent) return;
    sent = true;
    for (const [name, value] of Object.entries(v)) {
      core.track('$web_vital', { metric: name, value: name === 'CLS' ? Math.round(value * 1000) / 1000 : Math.round(value) });
    }
  });
}
