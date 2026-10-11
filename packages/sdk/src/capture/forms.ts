import type { Core } from '../core';
import { fieldNameOf } from '../selector';
import { now, on, trunc } from '../util';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface FieldState {
  focusAt: number;
  firstInputAt: number;
  /** last blurred value, kept in memory only to detect re-fills; never sent */
  lastValue: string | undefined;
}

const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);
const NEVER_CAPTURE = new Set(['password', 'email', 'tel', 'number']);

const isField = (el: EventTarget | null): el is Field =>
  (el instanceof HTMLInputElement && !SKIP_TYPES.has(el.type)) || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

const valueOf = (el: Field): string =>
  el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? (el.checked ? 'on' : '') : el.value;

const lengthBucket = (n: number): string => (n === 0 ? '0' : n <= 5 ? '1-5' : n <= 20 ? '6-20' : '21+');

/**
 * Form interaction metadata: focus, blur (time in field, hesitation before typing, filled, re-fill),
 * validation errors, submit, and abandonment. Field VALUES are never sent unless the field is
 * explicitly whitelisted and is not an email/phone/password/number input.
 */
export function captureForms(core: Core): void {
  const state = new WeakMap<Field, FieldState>();
  const touched = new Map<HTMLFormElement | Document, Set<string>>();
  const submitted = new WeakSet<HTMLFormElement | Document>();
  const allow = new Set(core.opts.captureFields ?? []);

  const ownerOf = (el: Field): HTMLFormElement | Document => el.form ?? document;

  on(document, 'focusin', (e) => {
    const el = e.target;
    if (!isField(el)) return;
    const name = fieldNameOf(el);
    const prev = state.get(el);
    state.set(el, { focusAt: now(), firstInputAt: 0, lastValue: prev?.lastValue });
    core.lastField = name;
    const owner = ownerOf(el);
    if (!touched.has(owner)) touched.set(owner, new Set());
    touched.get(owner)!.add(name);
    core.track('$form_field_focus', { field: name, field_type: el.type });
  });

  on(document, 'input', (e) => {
    const el = e.target;
    if (!isField(el)) return;
    const s = state.get(el);
    if (s && !s.firstInputAt) s.firstInputAt = now();
  });

  on(document, 'focusout', (e) => {
    const el = e.target;
    if (!isField(el)) return;
    const s = state.get(el);
    if (!s) return;
    const t = now();
    const name = fieldNameOf(el);
    const value = valueOf(el);
    const props: Record<string, string | number | boolean> = {
      field: name,
      field_type: el.type,
      duration_ms: t - s.focusAt,
      hesitation_ms: s.firstInputAt ? s.firstInputAt - s.focusAt : 0,
      filled: value.length > 0,
      changed: s.lastValue !== undefined && s.lastValue !== value,
      refill: s.lastValue !== undefined && s.lastValue.length > 0 && s.lastValue !== value,
      length_bucket: lengthBucket(value.length),
    };
    const whitelisted = (allow.has(name) || el.hasAttribute('data-wa-capture')) && !NEVER_CAPTURE.has(el.type);
    if (whitelisted) props.value = trunc(value, 64);
    s.lastValue = value;
    core.track('$form_field_blur', props, t);
  });

  // Native constraint validation
  on(document, 'invalid', (e) => {
    const el = e.target;
    if (!isField(el)) return;
    core.track('$form_field_error', { field: fieldNameOf(el), error: trunc(el.validationMessage, 120), kind: 'native' });
  });

  // Framework validation usually toggles aria-invalid; read the described-by message text.
  try {
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target;
        if (!isField(el) || el.getAttribute('aria-invalid') !== 'true') continue;
        const ids = el.getAttribute('aria-describedby') ?? el.getAttribute('aria-errormessage') ?? '';
        const msg = ids
          .split(/\s+/)
          .map((id) => (id ? document.getElementById(id)?.textContent ?? '' : ''))
          .join(' ');
        core.track('$form_field_error', { field: fieldNameOf(el), error: trunc(msg, 120), kind: 'aria' });
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['aria-invalid'], subtree: true });
  } catch {
    /* ignore */
  }

  on(document, 'submit', (e) => {
    const form = e.target instanceof HTMLFormElement ? e.target : null;
    if (!form) return;
    submitted.add(form);
    core.track('$form_submit', {
      form: form.getAttribute('name') || form.id || form.getAttribute('action')?.split('?')[0] || 'form',
      fields: form.elements.length,
    });
  });

  core.leaveHooks.push((reason) => {
    // SPA step changes are not abandonment; only a real unload with unsubmitted fields is
    if (reason !== 'unload') return;
    for (const [owner, fields] of touched) {
      if (submitted.has(owner)) continue;
      core.track('$form_abandon', {
        form: owner instanceof HTMLFormElement ? owner.getAttribute('name') || owner.id || 'form' : 'page',
        last_field: core.lastField,
        fields_touched: fields.size,
      });
    }
    touched.clear();
  });
}

/** Manual validation error API: weart.fieldError('email', 'invalid_format') */
export function fieldError(core: Core, field: string, error: string): void {
  core.track('$form_field_error', { field: trunc(field, 64), error: trunc(error, 120), kind: 'manual' });
}
