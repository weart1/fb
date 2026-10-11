import type { Core } from './core';
import type { Props } from './types';
import { now } from './util';

/**
 * Flow helper for multi-step funnels such as /onboarding-3.
 *
 *   const ob = weart.flow('onboarding-3', { version: 'v3' })
 *   ob.step(1, 'intro')      // onboarding_started (first time) + onboarding_step_viewed
 *   ob.step(2, 'style')      // auto-completes step 1 with its duration, then views step 2
 *   ob.error('email', 'invalid_format')
 *   ob.finish({ plan: 'pro' })
 *
 * While a flow is open, every auto-captured event (clicks, form fields, errors) carries
 * flow_id/step/step_name so it can be attributed to the step.
 */
export class Flow {
  private current: { step: number; name: string; at: number; active: number; completed: boolean } | undefined;
  private started = false;
  private done = false;

  constructor(
    private readonly core: Core,
    readonly id: string,
    private readonly version = '',
  ) {
    core.leaveHooks.push((reason) => {
      // best-effort abandonment signal on real unload (SPA step changes are not abandonment);
      // drop-off is also derived server-side from flow_steps for mobile tabs that never unload
      if (reason === 'unload' && this.current && !this.done && core.flowCtx?.flow_id === this.id) {
        this.emit('onboarding_abandoned', {
          last_step: this.current.step,
          last_step_name: this.current.name,
          last_field: core.lastField,
          active_ms_on_step: Math.round(core.activity.snapshot().active - this.current.active),
          duration_ms: now() - this.current.at,
        });
      }
    });
  }

  private emit(name: string, props?: Props): void {
    this.core.track(name, { flow_version: this.version, ...props });
  }

  step(step: number, name: string, props?: Props): void {
    const prev = this.current;
    if (prev && prev.step === step) return;
    if (prev && !prev.completed && step > prev.step) this.complete();
    if (prev && step < prev.step) this.emit('onboarding_step_back', { from_step: prev.step, to_step: step });

    this.core.flowCtx = { flow_id: this.id, step, step_name: name };
    this.current = { step, name, at: now(), active: this.core.activity.snapshot().active, completed: false };
    if (!this.started) {
      this.started = true;
      this.emit('onboarding_started', { first_step: step });
    }
    this.emit('onboarding_step_viewed', { ...props, is_revisit: !!prev && step < prev.step });
  }

  /** Mark the current step as completed (call when the user advances). */
  complete(props?: Props): void {
    const c = this.current;
    if (!c || c.completed) return;
    c.completed = true;
    this.emit('onboarding_step_completed', {
      ...props,
      duration_ms: now() - c.at,
      active_ms: Math.round(this.core.activity.snapshot().active - c.active),
    });
  }

  error(field: string, code: string): void {
    this.emit('onboarding_step_error', { field, error: code });
  }

  finish(props?: Props): void {
    if (this.done) return;
    this.complete();
    this.done = true;
    this.emit('onboarding_completed', props);
    this.core.flowCtx = undefined;
  }
}
