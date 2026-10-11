import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTouch } from '../src/attribution';
import { uuidv7 } from '../src/util';
import { clearStorage, events, setup, tick } from './helpers';

beforeEach(() => clearStorage());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ids', () => {
  it('uuidv7 encodes the timestamp and has version/variant bits', () => {
    const ts = Date.UTC(2026, 9, 11, 12, 0, 0);
    const id = uuidv7(ts);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ts);
  });
});

describe('attribution parsing', () => {
  it('reads utm, ad ids and click ids', () => {
    const t = parseTouch(
      'https://weartstudio.io/onboarding-3?utm_source=facebook&utm_medium=paid_social&utm_campaign=Spring&utm_content=Video1&campaign_id=111&adset_id=222&ad_id=333&fbclid=IwAR123',
      'https://l.facebook.com/',
      1,
    );
    expect(t).toMatchObject({
      utm_source: 'facebook',
      utm_campaign: 'Spring',
      campaign_id: '111',
      adset_id: '222',
      ad_id: '333',
      click_id_type: 'fbclid',
      click_id: 'IwAR123',
      referrer: 'https://l.facebook.com/',
    });
  });
  it('maps platform aliases (utm_id, hsa_*)', () => {
    expect(parseTouch('https://weartstudio.io/?gclid=x&hsa_cam=9&hsa_grp=8&hsa_ad=7', '', 1)).toMatchObject({
      click_id_type: 'gclid',
      campaign_id: '9',
      adset_id: '8',
      ad_id: '7',
    });
  });
  it('ignores internal referrers and plain visits', () => {
    expect(parseTouch('https://weartstudio.io/a', 'https://weartstudio.io/b', 1)).toBeUndefined();
    expect(parseTouch('https://weartstudio.io/a', '', 1)).toBeUndefined();
  });
});

describe('consent', () => {
  it('stores and sends nothing before consent, then flushes the buffered events', async () => {
    const { weart, sent, flush } = await setup({ consent: 'required', url: '/onboarding-3?utm_source=tiktok&utm_medium=cpc' });
    weart.track('before_consent');
    flush();
    await tick();
    expect(sent).toHaveLength(0);
    expect(document.cookie).not.toContain('wa_id');
    expect(localStorage.getItem('wa_id')).toBeNull();

    weart.consent('granted');
    await tick();
    const names = events(sent).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['$pageview', 'before_consent', '$consent']));
    expect(document.cookie).toContain('wa_id');
    expect(events(sent)[0]!.ctx.touch?.utm_source).toBe('tiktok');
  });

  it('denied: nothing is sent and identifiers are removed', async () => {
    const { weart, sent, flush } = await setup({ consent: 'required' });
    weart.consent('denied');
    weart.track('x');
    flush();
    await tick();
    expect(sent).toHaveLength(0);
    expect(document.cookie).toContain('wa_consent=denied');
    expect(document.cookie).not.toContain('wa_id=');
  });
});

describe('batching and sessions', () => {
  it('flushes automatically at flushSize and payload matches the wire schema', async () => {
    const { weart, sent } = await setup({});
    for (let i = 0; i < 25; i++) weart.track('e', { i });
    await tick();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]!.url).toBe('https://e.weartstudio.io/v1/batch');
    expect(sent[0]!.body.site).toBe('weartstudio');
  });

  it('rotates the session after 30 minutes of inactivity', async () => {
    const { weart, flush, sent } = await setup({});
    const first = weart.sessionId;
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 31 * 60_000);
    weart.track('later');
    flush();
    await tick();
    expect(weart.sessionId).not.toBe(first);
    const later = events(sent).find((e) => e.name === 'later')!;
    expect(later.ctx.session_id).not.toBe(first);
  });

  it('a new ad click starts a new session; a direct return inherits the last touch', async () => {
    let s = await setup({ url: '/onboarding-3?utm_source=facebook&utm_campaign=A&fbclid=1' });
    const first = s.weart.sessionId;
    s = await setup({ url: '/onboarding-3?utm_source=facebook&utm_campaign=B&fbclid=2' });
    expect(s.weart.sessionId).not.toBe(first);

    // direct visit in a new session: keeps last non-direct touch (campaign B), first touch stays A
    localStorage.removeItem('wa_s');
    document.cookie = 'wa_s=; path=/; max-age=-1';
    s = await setup({ url: '/pricing' });
    s.flush();
    await tick();
    const ctx = events(s.sent)[0]!.ctx;
    expect(ctx.touch?.utm_campaign).toBe('B');
    expect(ctx.first_touch?.utm_campaign).toBe('A');
  });

  it('keeps failed batches and retries them', async () => {
    const s = await setup({ fetchStatus: 'error' });
    s.weart.track('offline_event');
    s.flush();
    await tick();
    expect(localStorage.getItem('wa_q')).toContain('offline_event');
  });
});

describe('forms', () => {
  it('captures metadata but never values (unless whitelisted, never email)', async () => {
    document.body.innerHTML = `
      <form name="details">
        <input name="email" type="email" />
        <input name="first_name" />
        <select name="plan_choice"><option value="pro">Pro</option></select>
      </form>`;
    const { flush, sent } = await setup({ captureFields: ['plan_choice', 'email'] });
    const email = document.querySelector<HTMLInputElement>('[name=email]')!;
    const name = document.querySelector<HTMLInputElement>('[name=first_name]')!;
    const plan = document.querySelector<HTMLSelectElement>('[name=plan_choice]')!;
    for (const [el, val] of [
      [email, 'jane@example.com'],
      [name, 'Jane'],
    ] as const) {
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
    plan.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    plan.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    flush();
    await tick();
    const payload = JSON.stringify(sent.map((s) => s.body));
    expect(payload).not.toContain('jane@example.com');
    expect(payload).not.toContain('Jane');
    const blurs = events(sent).filter((e) => e.name === '$form_field_blur');
    expect(blurs.map((b) => b.props?.field)).toEqual(['email', 'first_name', 'plan_choice']);
    expect(blurs[0]!.props).toMatchObject({ filled: true, length_bucket: '6-20' });
    expect(blurs[0]!.props?.value).toBeUndefined();
    expect(blurs[2]!.props?.value).toBe('pro');
  });
});

describe('clicks', () => {
  it('detects rage clicks', async () => {
    document.body.innerHTML = '<button data-wa="cta-continue">Continue</button>';
    const { flush, sent } = await setup({});
    const b = document.querySelector('button')!;
    for (let i = 0; i < 3; i++) b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    flush();
    await tick();
    const ev = events(sent);
    expect(ev.filter((e) => e.name === '$click')).toHaveLength(3);
    const rage = ev.find((e) => e.name === '$rage_click');
    expect(rage?.props).toMatchObject({ selector: '[data-wa="cta-continue"]', text: 'Continue' });
  });
});

describe('identify', () => {
  it('drops raw email traits and sets user_id', async () => {
    const { weart, flush, sent } = await setup({});
    weart.identify('user_42', { email: 'a@b.co', email_hash: 'abc123', plan: 'pro' });
    flush();
    await tick();
    const id = events(sent).find((e) => e.name === '$identify')!;
    expect(id.ctx.user_id).toBe('user_42');
    expect(id.props).toMatchObject({ email_hash: 'abc123', plan: 'pro' });
    expect(id.props?.email).toBeUndefined();
  });
});

describe('flow helper', () => {
  it('tracks steps with durations and attaches flow context to other events', async () => {
    const { weart, flush, sent } = await setup({});
    const ob = weart.flow('onboarding-3', { version: 'v3' });
    ob.step(1, 'intro');
    ob.step(2, 'style');
    weart.track('custom_in_step');
    ob.step(1, 'intro'); // back
    ob.finish({ plan: 'pro' });
    flush();
    await tick();
    const ev = events(sent);
    const names = ev.map((e) => e.name).filter((n) => n.startsWith('onboarding'));
    expect(names).toEqual([
      'onboarding_started',
      'onboarding_step_viewed',
      'onboarding_step_completed',
      'onboarding_step_viewed',
      'onboarding_step_back',
      'onboarding_step_viewed',
      'onboarding_step_completed',
      'onboarding_completed',
    ]);
    const completed = ev.find((e) => e.name === 'onboarding_step_completed')!;
    expect(completed.props).toMatchObject({ flow_id: 'onboarding-3', step: 1, step_name: 'intro', flow_version: 'v3' });
    expect(typeof completed.props?.duration_ms).toBe('number');
    expect(ev.find((e) => e.name === 'custom_in_step')!.props).toMatchObject({ step: 2, step_name: 'style' });
  });
});

describe('experiments', () => {
  it('assigns sticky variants and fires a single exposure', async () => {
    const config = {
      experiments: [{ key: 'ob_style_step', traffic: 1, variants: [{ key: 'control', weight: 1 }, { key: 'grid', weight: 1 }] }],
      replay_sample_rate: 0,
      snapshot_sample_rate: 0,
      capture_fields: [],
    };
    const { weart, flush, sent } = await setup({ config });
    const v = await weart.getVariantAsync('ob_style_step');
    expect(['control', 'grid']).toContain(v);
    expect(weart.getVariant('ob_style_step')).toBe(v);
    expect(weart.getVariant('unknown')).toBeNull();
    flush();
    await tick();
    const exposures = events(sent).filter((e) => e.name === '$exposure');
    expect(exposures).toHaveLength(1);
    expect(exposures[0]!.ctx.experiments).toEqual({ ob_style_step: v });
  });
});
