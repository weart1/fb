const INTERACTIVE = 'a,button,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=option],input,select,textarea,label,summary,[data-wa],[onclick]';
const HASHED_CLASS = /\d{3,}|^(css|sc|jsx|tw|emotion|svelte)-|__|^[a-z0-9]{6,}$/i;

export function interactiveAncestor(el: Element): Element | null {
  return el.closest(INTERACTIVE);
}

/** Short, stable CSS selector. Prefers data-wa / data-testid / ids; skips CSS-in-JS hashed classes. */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  let e: Element | null = el;
  for (let depth = 0; e && depth < 5; depth++) {
    const wa = e.getAttribute('data-wa');
    if (wa) {
      parts.unshift(`[data-wa="${wa}"]`);
      break;
    }
    const tid = e.getAttribute('data-testid');
    if (tid) {
      parts.unshift(`[data-testid="${tid}"]`);
      break;
    }
    let s = e.tagName.toLowerCase();
    if (e.id && !/\d{3,}|:/.test(e.id)) {
      parts.unshift(`${s}#${e.id}`);
      break;
    }
    const cls = Array.from(e.classList)
      .filter((c) => !HASHED_CLASS.test(c))
      .slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    const parent: Element | null = e.parentElement;
    if (parent) {
      const tag = e.tagName;
      const same = Array.from(parent.children).filter((c) => c.tagName === tag);
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`;
    }
    parts.unshift(s);
    if (s === 'body') break;
    e = parent;
  }
  return parts.join('>').slice(0, 512);
}

/** Visible label of an element; never reads form values except for button-like inputs. */
export function textOf(el: Element): string {
  if (el.closest('[data-wa-mask]')) return '';
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return t === 'submit' || t === 'button' ? (el as HTMLInputElement).value : '';
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return '';
  return (el as HTMLElement).innerText || el.textContent || el.getAttribute('aria-label') || '';
}

export function fieldNameOf(el: Element): string {
  return (
    el.getAttribute('data-wa-field') ||
    el.getAttribute('name') ||
    el.id ||
    el.getAttribute('aria-label') ||
    el.getAttribute('autocomplete') ||
    el.tagName.toLowerCase()
  ).slice(0, 64);
}
