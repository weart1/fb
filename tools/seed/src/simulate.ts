import { emptyEventRow, type EventRow } from '@weart/queries';
import { adPlatform, classifyChannel, domainOf } from '@weart/shared';
import {
  CAMPAIGNS,
  COUNTRIES,
  DEVICE_MIX,
  DEVICES,
  EXPERIMENT,
  PAGES,
  STEP_CONTINUE,
  STEP_FIELDS,
  STEP_NAMES,
  STEP_TIME_S,
  type Ad,
  type AdSet,
  type Campaign,
  type DeviceProfile,
  type PageKey,
} from './catalog';
import type { Rng } from './rng';

export const PROJECT = 'weartstudio';
const HOST = 'weartstudio.io';
const SDK = '0.1.0';

export interface Touch {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  creative_id: string;
  click_id_type: string;
  click_id: string;
  referrer: string;
  landing_path: string;
  ts: number;
  campaign?: Campaign;
  adset?: AdSet;
  ad?: Ad;
}

export interface Visitor {
  anon: string;
  deviceKey: string;
  device: DeviceProfile;
  country: string;
  city: string;
  language: string;
  timezone: string;
  userId: string;
  emailHash: string;
  firstTouch: Touch | undefined;
  lastTouch: Touch | undefined;
  variant: string;
  completed: boolean;
  sessions: number;
}

export interface SessionResult {
  rows: EventRow[];
  /** furthest onboarding step reached (0 = none) */
  maxStep: number;
  completed: boolean;
  revenue: number;
}

const TZ: Record<string, string> = {
  US: 'America/New_York', GB: 'Europe/London', CA: 'America/Toronto', DE: 'Europe/Berlin', AU: 'Australia/Sydney', FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam', ES: 'Europe/Madrid', IT: 'Europe/Rome', SE: 'Europe/Stockholm', BR: 'America/Sao_Paulo', PL: 'Europe/Warsaw',
};

export function newVisitor(rng: Rng, deviceMix: ReadonlyArray<readonly [string, number]>, ts: number): Visitor {
  const deviceKey = rng.weighted(deviceMix);
  const [country, , cities, language] = rng.weighted(COUNTRIES.map((c) => [c, c[1]] as const));
  return {
    anon: rng.uuidv7(ts - rng.int(0, 1000)),
    deviceKey,
    device: DEVICES[deviceKey]!,
    country,
    city: rng.pick(cities),
    language,
    timezone: TZ[country] ?? 'UTC',
    userId: '',
    emailHash: '',
    firstTouch: undefined,
    lastTouch: undefined,
    variant: rng.chance(0.5) ? 'control' : 'grid',
    completed: false,
    sessions: 0,
  };
}

const CLICK_PREFIX: Record<string, string> = { fbclid: 'IwAR', gclid: 'Cj0KCQjw', ttclid: 'E_C_P_' };

export function paidTouch(rng: Rng, c: Campaign, adset: AdSet, a: Ad, ts: number, device: DeviceProfile): Touch {
  const landing: PageKey = rng.chance(0.84) ? 'onboarding' : 'home';
  let utm_source: string = c.platform;
  let utm_medium = 'paid_social';
  let clickType = 'fbclid';
  let referrer = '';
  if (c.platform === 'meta') {
    utm_source = device.in_app_browser === 'facebook' ? 'facebook' : 'instagram';
    referrer = utm_source === 'facebook' ? 'https://m.facebook.com/' : 'https://l.instagram.com/';
  } else if (c.platform === 'google') {
    utm_medium = 'cpc';
    clickType = rng.chance(0.85) ? 'gclid' : device.os === 'iOS' ? 'wbraid' : 'gclid';
    referrer = 'https://www.google.com/';
  } else {
    clickType = 'ttclid';
    referrer = rng.chance(0.3) ? 'https://www.tiktok.com/' : '';
  }
  return {
    utm_source,
    utm_medium,
    utm_campaign: c.name,
    utm_content: a.name,
    utm_term: adset.name,
    campaign_id: c.id,
    adset_id: adset.id,
    ad_id: a.id,
    creative_id: a.creativeId,
    click_id_type: clickType,
    click_id: `${CLICK_PREFIX[clickType] ?? ''}${rng.hex(24)}`,
    referrer,
    landing_path: PAGES[landing].path,
    ts,
    campaign: c,
    adset,
    ad: a,
  };
}

export function organicTouch(rng: Rng, ts: number): Touch | undefined {
  const kind = rng.weighted([
    ['direct', 34],
    ['search', 34],
    ['social', 14],
    ['referral', 10],
    ['email', 8],
  ] as const);
  const base: Touch = {
    utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '', campaign_id: '', adset_id: '', ad_id: '', creative_id: '',
    click_id_type: '', click_id: '', referrer: '', landing_path: '/', ts,
  };
  const landing = rng.weighted<PageKey>([['home', 50], ['blog', 18], ['pricing', 10], ['gallery', 10], ['onboarding', 12]]);
  base.landing_path = PAGES[landing].path;
  switch (kind) {
    case 'direct':
      return undefined;
    case 'search':
      return { ...base, referrer: rng.pick(['https://www.google.com/', 'https://www.google.com/', 'https://www.bing.com/', 'https://duckduckgo.com/']) };
    case 'social':
      return { ...base, referrer: rng.pick(['https://www.pinterest.com/', 'https://l.instagram.com/', 'https://www.reddit.com/']) };
    case 'referral':
      return { ...base, referrer: rng.pick(['https://www.creativebloq.com/', 'https://artstation.com/', 'https://medium.com/']) };
    case 'email':
      return { ...base, utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'weekly-digest' };
  }
}

function touchCols(t: Touch | undefined) {
  const referrer_domain = domainOf(t?.referrer);
  const click = (t?.click_id_type ?? '') as 'fbclid' | 'gclid' | 'ttclid' | 'wbraid' | 'gbraid' | '';
  return {
    channel: classifyChannel({ utm_source: t?.utm_source, utm_medium: t?.utm_medium, click_id_type: click || undefined, referrer_domain }),
    ad_platform: adPlatform(t?.utm_source, click || undefined),
    utm_source: t?.utm_source ?? '',
    utm_medium: t?.utm_medium ?? '',
    utm_campaign: t?.utm_campaign ?? '',
    utm_content: t?.utm_content ?? '',
    utm_term: t?.utm_term ?? '',
    campaign_id: t?.campaign_id ?? '',
    adset_id: t?.adset_id ?? '',
    ad_id: t?.ad_id ?? '',
    creative_id: t?.creative_id ?? '',
    click_id_type: t?.click_id_type ?? '',
    click_id: t?.click_id ?? '',
    referrer_domain,
    landing_path: t?.landing_path ?? '',
  };
}

const PLAN_PRICES: Record<string, number> = { basic_monthly: 12, basic_yearly: 120, pro_monthly: 29, pro_yearly: 290 };

/**
 * One session: landing, browsing, the onboarding flow with per-step timing, field interactions,
 * errors, rage/dead clicks, back navigation, drop-off or completion, and revenue.
 */
export function simulateSession(rng: Rng, v: Visitor, sessionTouch: Touch | undefined, start: number, dayIndex: number): SessionResult {
  v.sessions++;
  const sessionId = rng.uuidv7(start);
  const isReturn = v.sessions > 1;
  const sc = touchCols(sessionTouch);
  const ft = touchCols(v.firstTouch);
  const d = v.device;
  const exposed: Record<string, string> = {};
  const base: EventRow = {
    ...emptyEventRow(),
    project_id: PROJECT,
    anonymous_id: v.anon,
    session_id: sessionId,
    session_start: start,
    user_id: v.userId,
    host: HOST,
    ...sc,
    ft_channel: ft.channel,
    ft_ad_platform: ft.ad_platform,
    ft_utm_source: ft.utm_source,
    ft_utm_medium: ft.utm_medium,
    ft_utm_campaign: ft.utm_campaign,
    ft_campaign_id: ft.campaign_id,
    ft_adset_id: ft.adset_id,
    ft_ad_id: ft.ad_id,
    ft_creative_id: ft.creative_id,
    ft_ts: v.firstTouch?.ts ?? start,
    device_type: d.device_type,
    browser: d.browser,
    browser_version: d.browser_version,
    os: d.os,
    os_version: d.os_version,
    in_app_browser: d.in_app_browser,
    screen_w: d.screen[0],
    screen_h: d.screen[1],
    viewport_w: d.viewport[0],
    viewport_h: d.viewport[1],
    language: v.language,
    timezone: v.timezone,
    country: v.country,
    city: v.city,
    sdk_version: SDK,
  };

  const rows: EventRow[] = [];
  let t = start;
  let page: { path: string; url: string; title: string } = { path: '', url: '', title: '' };
  let pageStart = t;
  let flow: { step: number; name: string } | undefined;

  const emit = (event: string, extra: Partial<EventRow> = {}, props: Record<string, unknown> = {}): void => {
    rows.push({
      ...base,
      event_id: rng.uuidv7(t),
      event,
      ts: t,
      received_at: t + rng.int(80, 2500),
      user_id: v.userId,
      url: page.url,
      path: page.path,
      title: page.title,
      ...(flow ? { flow_id: 'onboarding-3', step: flow.step, step_name: flow.name } : {}),
      experiments: { ...exposed },
      properties: JSON.stringify(props),
      ...extra,
    });
  };
  const wait = (ms: number): void => {
    t += Math.max(50, Math.round(ms));
  };

  const leave = (final: boolean): void => {
    const wall = t - pageStart;
    const active = Math.round(wall * (0.55 + rng.next() * 0.4));
    emit('$pageleave', { duration_ms: active, idle_ms: wall - active, value: rng.int(25, 100) }, { final, visible_ms: wall });
  };

  const view = (key: PageKey, query = '', referrer = ''): void => {
    if (page.path) leave(true);
    const p = PAGES[key];
    page = { path: p.path, url: `https://${HOST}${p.path}${query}`, title: p.title };
    pageStart = t;
    emit('$pageview', { referrer }, {});
  };

  const vitals = (): number => {
    const mobile = d.device_type !== 'desktop';
    const inApp = d.in_app_browser !== '';
    const lcp = Math.round(rng.logNormal(mobile ? (inApp ? 2900 : 2300) : 1500, 0.45));
    wait(rng.int(1500, 4000));
    emit('$web_vital', { value: Math.round(rng.logNormal(mobile ? 650 : 280, 0.4)) }, { metric: 'TTFB' });
    emit('$web_vital', { value: Math.round(lcp * 0.7) }, { metric: 'FCP' });
    emit('$web_vital', { value: lcp }, { metric: 'LCP' });
    emit('$web_vital', { value: Math.round(rng.logNormal(0.06, 0.9) * 1000) / 1000 }, { metric: 'CLS' });
    return lcp;
  };

  const click = (selector: string, text: string, kind = '$click'): void => {
    const x = rng.int(20, d.viewport[0] - 20);
    const y = rng.int(120, d.viewport[1] - 40);
    emit(kind, { element_selector: selector, element_text: text, x, y, page_x: x, page_y: y + rng.int(0, 200) }, { tag: selector.startsWith('a') ? 'a' : 'button' });
  };

  const scroll = (maxDepth: number): void => {
    for (const depth of [25, 50, 75, 100]) {
      if (depth > maxDepth) break;
      wait(rng.int(800, 5000));
      emit('$scroll_depth', { value: depth }, { depth });
    }
  };

  const browse = (key: PageKey): void => {
    view(key);
    wait(rng.int(1500, 6000));
    scroll(rng.weighted([[25, 3], [50, 3], [75, 2], [100, 2]]));
    if (rng.chance(0.5)) click(`a.nav-link:nth-of-type(${rng.int(1, 4)})`, rng.pick(['Pricing', 'Gallery', 'FAQ', 'Get started']));
    wait(rng.int(2000, 20000));
  };

  // ---------------------------------------------------------------- landing
  const landingKey = (Object.keys(PAGES) as PageKey[]).find((k) => PAGES[k].path === (sessionTouch?.landing_path || '/')) ?? 'home';
  const query = sessionTouch?.utm_source
    ? `?utm_source=${encodeURIComponent(sessionTouch.utm_source)}&utm_medium=${sessionTouch.utm_medium}&utm_campaign=${encodeURIComponent(sessionTouch.utm_campaign)}`
    : '';
  view(isReturn && !sessionTouch?.utm_source ? (rng.chance(0.6) ? 'onboarding' : 'home') : landingKey, query, sessionTouch?.referrer ?? '');
  const lcp = vitals();

  const q = sessionTouch?.campaign?.quality;
  const adsetQ = sessionTouch?.adset?.quality;
  const adQ = sessionTouch?.ad?.quality;
  let bounce = adQ?.bounce ?? adsetQ?.bounce ?? q?.bounce ?? (sessionTouch ? 0.42 : 0.35);
  if (lcp > 4000) bounce += 0.15;
  if (isReturn) bounce *= 0.6;
  if (rng.chance(bounce)) {
    if (rng.chance(0.4)) scroll(25);
    wait(rng.logNormal(6000, 0.8));
    leave(true);
    return { rows, maxStep: 0, completed: false, revenue: 0 };
  }

  if (page.path !== PAGES.onboarding.path) {
    browse(rng.pick(['pricing', 'gallery', 'faq'] as const));
    const goOnboarding = sessionTouch?.campaign ? 0.55 : isReturn ? 0.5 : 0.2;
    if (!rng.chance(goOnboarding)) {
      if (rng.chance(0.4)) browse(rng.pick(['blog', 'gallery', 'login'] as const));
      leave(true);
      return { rows, maxStep: 0, completed: false, revenue: 0 };
    }
    click('[data-wa="cta-get-started"]', 'Get started');
    wait(rng.int(300, 1200));
    view('onboarding');
  }

  // ---------------------------------------------------------------- onboarding flow
  const speed = (adQ?.speed ?? adsetQ?.speed ?? q?.speed ?? 1) * (d.device_type === 'desktop' ? 1.1 : 1);
  const inExperiment = dayIndex >= EXPERIMENT.startDay;
  let maxStep = 0;
  let revenue = 0;
  let plan = 'pro_monthly';

  const fieldInteraction = (field: string, opts: { filled: boolean; error?: string; abandon?: boolean }): void => {
    emit('$form_field_focus', { field_name: field }, { field, field_type: field === 'email' ? 'email' : 'text' });
    const dur = Math.round(rng.logNormal(field.startsWith('card') ? 9000 : field === 'email' ? 7000 : 4000, 0.6));
    const hesitation = Math.round(dur * (0.1 + rng.next() * 0.35) * (opts.abandon ? 2.5 : 1));
    wait(dur);
    if (opts.abandon) return; // left while focused: no blur
    const refill = !!opts.error && rng.chance(0.7);
    emit(
      '$form_field_blur',
      { field_name: field, duration_ms: dur, value: hesitation },
      { field, filled: opts.filled, changed: refill, refill, length_bucket: opts.filled ? '6-20' : '0', hesitation_ms: hesitation },
    );
    if (opts.error) {
      wait(rng.int(200, 600));
      emit('$form_field_error', { field_name: field, error_message: opts.error }, { field, error: opts.error, kind: 'aria' });
    }
  };

  for (let step = 1; step <= 6; step++) {
    const name = STEP_NAMES[step]!;
    flow = { step, name };
    if (step > 1) {
      // SPA route per step
      leave(true);
      page = { ...page, url: `https://${HOST}/onboarding-3?step=${name}` };
      pageStart = t;
      emit('$pageview', {}, {});
    }
    if (step === 1) emit('onboarding_started', {}, { first_step: 1, flow_version: 'v3' });
    if (step === 2 && inExperiment) {
      exposed[EXPERIMENT.key] = v.variant;
      emit('$exposure', {}, { experiment: EXPERIMENT.key, variant: v.variant });
    }
    emit('onboarding_step_viewed', {}, { flow_version: 'v3', is_revisit: false });
    maxStep = Math.max(maxStep, step);

    let p = STEP_CONTINUE[step]!;
    p *= q?.stepMult?.[step] ?? 1;
    p *= adsetQ?.stepMult?.[step] ?? 1;
    p *= adQ?.stepMult?.[step] ?? 1;
    if (step === 1 && lcp > 3000) p *= 0.82;
    if (step === 2 && inExperiment && v.variant === 'grid') p *= 1.08;
    if (step === 6 && d.in_app_browser) p *= 0.72;
    if (step === 4 && d.device_type === 'mobile') p *= 0.94;
    if (isReturn) p *= 1.18;
    const cont = rng.chance(Math.min(0.97, p));

    const stepMs = rng.logNormal(STEP_TIME_S[step]! * 1000 * speed, 0.55) * (cont ? 1 : rng.chance(0.5) ? 1.8 : 0.6);
    const stepStart = t;
    const fields = STEP_FIELDS[step] ?? [];

    // interactions inside the step
    if (step === 1) {
      wait(stepMs * 0.8);
    } else if (step === 2) {
      wait(stepMs * 0.3);
      if (rng.chance(0.12)) {
        click('.style-card>img', '', '$click');
        wait(rng.int(1000, 1600));
        click('.style-card>img', '', '$dead_click');
      }
      click(`[data-wa="style-${rng.pick(['minimal', 'bold', 'retro', 'abstract'])}"]`, rng.pick(['Minimal', 'Bold', 'Retro', 'Abstract']));
      wait(stepMs * 0.4);
    } else if (step === 5) {
      wait(stepMs * 0.25);
      for (const f of fields) fieldInteraction(f, { filled: true });
      plan = `${rng.chance(0.58) ? 'pro' : 'basic'}_${rng.chance(0.14) ? 'yearly' : 'monthly'}`;
      if (rng.chance(d.device_type === 'mobile' ? 0.2 : 0.09)) {
        // the monthly/yearly toggle is too small on mobile → rage clicks
        for (let i = 0; i < 3; i++) click('[data-wa="plan-toggle"]', 'Monthly / Yearly');
        emit('$rage_click', { element_selector: '[data-wa="plan-toggle"]', element_text: 'Monthly / Yearly', x: 180, y: 320 }, { count: 3 });
      }
    } else {
      wait(stepMs * 0.15);
      const abandonField = !cont && fields.length
        ? step === 4
          ? rng.weighted([['email', 60], ['phone', 27], ['first_name', 13]] as const)
          : rng.pick(fields)
        : undefined;
      for (const f of fields) {
        if (f === 'phone' && step === 4 && rng.chance(0.35) && abandonField !== 'phone') continue; // optional field skipped
        const error =
          step === 4 && f === 'email' && rng.chance(0.24)
            ? rng.pick(['Please enter a valid email', 'This email is already registered'])
            : step === 6 && f === 'card_number' && rng.chance(0.18)
              ? rng.pick(['Your card number is incomplete', 'Your card was declined'])
              : undefined;
        if (f === abandonField) {
          if (error && rng.chance(0.5)) fieldInteraction(f, { filled: true, error });
          fieldInteraction(f, { filled: false, abandon: true });
          break;
        }
        fieldInteraction(f, { filled: true, ...(error ? { error } : {}) });
        if (error) {
          emit('onboarding_step_error', { field_name: f, error_message: error }, { field: f, error: 'validation' });
          fieldInteraction(f, { filled: true });
        }
      }
      if (step === 6 && d.in_app_browser && rng.chance(0.14)) {
        emit('$error', { error_message: "TypeError: Cannot read properties of undefined (reading 'canMakePayment')" }, { source: 'https://js.stripe.com/v3/', line: 1, kind: 'error' });
      }
      if (step === 6 && rng.chance(0.04)) {
        emit('$network_error', { duration_ms: rng.int(3000, 15000) }, { method: 'POST', url: 'https://weartstudio.io/api/checkout/session', status: 502 });
      }
    }

    // occasional back navigation
    if (cont && step >= 3 && step <= 5 && rng.chance(0.07)) {
      emit('onboarding_step_back', {}, { from_step: step, to_step: step - 1 });
      wait(rng.int(3000, 9000));
    }

    if (!cont) {
      wait(rng.int(500, 4000));
      // exit: most leave the site, some look for reassurance first
      const exitTo = rng.weighted([['leave', 64], ['pricing', 16], ['faq', 10], ['home', 10]] as const);
      flow = { step, name };
      if (rng.chance(0.62)) {
        emit('onboarding_abandoned', { duration_ms: t - stepStart }, { last_step: step, last_step_name: name, active_ms_on_step: Math.round((t - stepStart) * 0.7) });
      }
      flow = undefined;
      if (exitTo !== 'leave') browse(exitTo);
      leave(true);
      return { rows, maxStep, completed: false, revenue: 0 };
    }

    const cta = step === 6 ? `Pay $${PLAN_PRICES[plan]}` : step === 1 ? 'Get started' : 'Continue';
    click(step === 1 ? '[data-wa="ob-start"]' : '[data-wa="ob-continue"]', cta);
    wait(rng.int(150, 800));
    emit('onboarding_step_completed', { duration_ms: t - stepStart }, { flow_version: 'v3', active_ms: Math.round((t - stepStart) * 0.8) });

    if (step === 4) {
      if (!v.userId) {
        v.userId = `usr_${rng.hex(12)}`;
        v.emailHash = rng.hex(64);
      }
      emit('$identify', { user_id: v.userId }, { email_hash: v.emailHash, plan: 'free' });
      emit('sign_up', { user_id: v.userId }, { email_hash: v.emailHash });
    }
  }

  // ---------------------------------------------------------------- completion
  revenue = PLAN_PRICES[plan]!;
  emit('onboarding_completed', {}, { flow_version: 'v3', plan });
  flow = undefined;
  emit('purchase', { revenue, currency: 'USD', order_id: `ord_${rng.hex(10)}` }, { plan, email_hash: v.emailHash });
  v.completed = true;
  wait(rng.int(2000, 8000));
  leave(true);
  if (rng.chance(0.5)) {
    view('gallery');
    wait(rng.int(5000, 40000));
    leave(true);
  }
  return { rows, maxStep: 6, completed: true, revenue };
}

export { CAMPAIGNS, DEVICE_MIX };
