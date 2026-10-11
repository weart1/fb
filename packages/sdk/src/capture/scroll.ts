import type { Core } from '../core';
import { on } from '../util';

const MARKS = [25, 50, 75, 100];

/** $scroll_depth once per threshold per page view. Exposes max depth for $pageleave. */
export function captureScroll(core: Core): () => number {
  let max = 0;
  let fired = new Set<number>();
  let raf = 0;

  const measure = (): void => {
    raf = 0;
    const doc = document.documentElement;
    const h = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
    const depth = h <= window.innerHeight ? 100 : Math.min(100, Math.round(((window.scrollY + window.innerHeight) / h) * 100));
    if (depth > max) max = depth;
    for (const m of MARKS) {
      if (depth >= m && !fired.has(m)) {
        fired.add(m);
        // pages shorter than the viewport would fire 100% instantly; only count real scrolling
        if (h > window.innerHeight * 1.1) core.track('$scroll_depth', { depth: m });
      }
    }
  };
  on(window, 'scroll', () => {
    if (!raf) raf = requestAnimationFrame(measure);
  });
  core.leaveHooks.push((final) => {
    if (!final) return;
    max = 0;
    fired = new Set();
  });
  return () => max;
}
