import type { Core } from '../core';
import { interactiveAncestor, selectorOf, textOf } from '../selector';
import { now, on, stripQuery, trunc } from '../util';

const RAGE_COUNT = 3;
const RAGE_WINDOW_MS = 700;
const RAGE_RADIUS_PX = 30;
const DEAD_WAIT_MS = 1000;

/**
 * $click for every click (coordinates feed heatmaps), $rage_click for bursts on one spot,
 * $dead_click when an interactive-looking element produces no DOM change, navigation or request.
 */
export function captureClicks(core: Core): void {
  let lastMutation = 0;
  let lastNav = 0;
  try {
    new MutationObserver(() => {
      lastMutation = now();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch {
    /* very old browser */
  }
  core.leaveHooks.push(() => {
    lastNav = now();
  });

  let burst: Array<{ t: number; x: number; y: number }> = [];

  on(document, 'click', (e: MouseEvent) => {
    const raw = e.target instanceof Element ? e.target : null;
    if (!raw) return;
    const target = interactiveAncestor(raw) ?? raw;
    const t = now();
    const sel = selectorOf(target);
    const tag = target.tagName.toLowerCase();
    const interactive = target !== raw || interactiveAncestor(raw) === raw;
    const doc = document.documentElement;
    const props = {
      selector: sel,
      tag,
      text: interactive ? trunc(textOf(target), 64) : '',
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      page_x: Math.round(e.pageX),
      page_y: Math.round(e.pageY),
      doc_w: doc.scrollWidth,
      doc_h: doc.scrollHeight,
      href: target instanceof HTMLAnchorElement ? stripQuery(target.href).slice(0, 512) : null,
    };
    core.track('$click', props, t);

    burst = burst.filter((b) => t - b.t < RAGE_WINDOW_MS && Math.hypot(b.x - e.clientX, b.y - e.clientY) < RAGE_RADIUS_PX);
    burst.push({ t, x: e.clientX, y: e.clientY });
    if (burst.length === RAGE_COUNT) core.track('$rage_click', { selector: sel, tag, text: props.text, x: props.x, y: props.y, page_x: props.page_x, page_y: props.page_y, count: RAGE_COUNT }, t);

    const looksClickable = interactive || getComputedStyle(target).cursor === 'pointer';
    const isFormControl = tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'label';
    if (looksClickable && !isFormControl) {
      setTimeout(() => {
        if (lastMutation < t && lastNav < t && core.lastNetwork < t) {
          core.track('$dead_click', { selector: sel, tag, text: props.text, x: props.x, y: props.y, page_x: props.page_x, page_y: props.page_y }, t + 1);
        }
      }, DEAD_WAIT_MS);
    }
  });
}
