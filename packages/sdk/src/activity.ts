import { now, on } from './util';

/** Input inside this window counts as "active"; beyond it the visible time is idle. */
export const IDLE_THRESHOLD_MS = 30_000;

/**
 * Active vs idle time. Active time grows only while the tab is visible and the user produced
 * input within the last IDLE_THRESHOLD_MS. No timers: deltas are added on each activity signal.
 */
export class Activity {
  active = 0;
  visible = 0;
  private lastInput = now();
  private visibleSince: number | undefined = document.visibilityState === 'visible' ? now() : undefined;

  constructor(onHidden: () => void, onVisible: () => void) {
    const mark = (): void => this.mark();
    for (const t of ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const) on(window, t, mark);
    let lastMove = 0;
    on(window, 'mousemove', () => {
      const t = now();
      if (t - lastMove > 1000) {
        lastMove = t;
        this.mark();
      }
    });
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.mark();
        if (this.visibleSince !== undefined) this.visible += now() - this.visibleSince;
        this.visibleSince = undefined;
        onHidden();
      } else {
        this.visibleSince = now();
        this.lastInput = now();
        onVisible();
      }
    });
  }

  mark(t: number = now()): void {
    if (this.visibleSince === undefined) return;
    this.active += Math.min(t - this.lastInput, IDLE_THRESHOLD_MS);
    this.lastInput = t;
  }

  /** Totals including the currently running visible interval. */
  snapshot(): { active: number; visible: number } {
    const t = now();
    const pendingActive = this.visibleSince === undefined ? 0 : Math.min(t - this.lastInput, IDLE_THRESHOLD_MS);
    const pendingVisible = this.visibleSince === undefined ? 0 : t - this.visibleSince;
    return { active: this.active + pendingActive, visible: this.visible + pendingVisible };
  }
}
