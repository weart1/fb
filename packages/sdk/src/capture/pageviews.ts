import type { Core } from '../core';
import { now, on, uuidv7 } from '../util';

/**
 * $pageview on load and on every SPA route change (History API + popstate).
 * $pageleave carries *incremental* active/visible time since the previous report for the same
 * page view, so a page hidden and resumed several times sums correctly server-side.
 */
export function capturePageviews(core: Core, getScrollMax: () => number): () => void {
  let path = location.pathname + location.search;
  let reported = { active: 0, visible: 0 };
  let startedAt = now();

  const leave = (final: boolean): void => {
    const snap = core.activity.snapshot();
    const active = snap.active - reported.active;
    const visible = snap.visible - reported.visible;
    reported = snap;
    if (!final && visible < 1000) return;
    core.track('$pageleave', {
      duration_ms: Math.max(0, Math.round(active)),
      idle_ms: Math.max(0, Math.round(visible - active)),
      visible_ms: Math.max(0, Math.round(visible)),
      wall_ms: now() - startedAt,
      scroll_max: getScrollMax(),
      final,
    });
  };
  core.leaveHooks.push(leave);

  const view = (): void => {
    core.pageviewId = uuidv7();
    startedAt = now();
    core.track('$pageview', { pv_id: core.pageviewId });
  };

  const onRoute = (): void => {
    const next = location.pathname + location.search;
    if (next === path) return;
    // Leave hooks (scroll reset, form abandon, flow bookkeeping) run before the new page view.
    for (const h of core.leaveHooks) h(true);
    path = next;
    view();
  };

  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = history[m];
    history[m] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      // defer: frameworks update document.title right after pushState
      setTimeout(onRoute, 0);
      return r;
    };
  }
  on(window, 'popstate', () => setTimeout(onRoute, 0));

  return view;
}
