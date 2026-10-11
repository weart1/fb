import type { Touch } from './types';
import { now } from './util';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const AD_IDS = ['campaign_id', 'adset_id', 'ad_id', 'creative_id'] as const;
const CLICK_IDS = ['fbclid', 'gclid', 'ttclid', 'wbraid', 'gbraid', 'msclkid'] as const;
/** Common aliases used by ad platform URL macros. */
const ALIASES: Record<string, (typeof AD_IDS)[number]> = {
  utm_id: 'campaign_id',
  hsa_cam: 'campaign_id',
  hsa_grp: 'adset_id',
  adgroup_id: 'adset_id',
  hsa_ad: 'ad_id',
};

/** Last non-direct touch is kept this long (same as GA). */
export const LAST_TOUCH_LOOKBACK_MS = 30 * 86400_000;

/** Parse campaign parameters from a URL + referrer. Returns undefined if the visit has no source info. */
export function parseTouch(href: string, referrer: string, ts: number = now()): Touch | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  const p = url.searchParams;
  const t: Touch = { ts };
  let has = false;
  for (const k of UTM) {
    const v = p.get(k);
    if (v) {
      t[k] = v.slice(0, 256);
      has = true;
    }
  }
  for (const [alias, k] of Object.entries(ALIASES)) {
    const v = p.get(alias);
    if (v && !p.get(k)) t[k] = v.slice(0, 64);
  }
  for (const k of AD_IDS) {
    const v = p.get(k);
    if (v) t[k] = v.slice(0, 64);
  }
  for (const k of CLICK_IDS) {
    const v = p.get(k);
    if (v) {
      t.click_id_type = k;
      t.click_id = v.slice(0, 512);
      has = true;
      break;
    }
  }
  const refHost = hostOf(referrer);
  const external = !!refHost && refHost !== url.hostname.replace(/^www\./, '');
  if (external) {
    t.referrer = referrer;
    has = true;
  }
  if (!has) return undefined;
  t.landing_url = href;
  return t;
}

function hostOf(u: string): string {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/** True if two touches represent the same campaign click (used to decide on session rotation). */
export function sameTouch(a: Touch | undefined, b: Touch | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.utm_source === b.utm_source &&
    a.utm_campaign === b.utm_campaign &&
    a.utm_content === b.utm_content &&
    a.ad_id === b.ad_id &&
    a.click_id === b.click_id
  );
}

/** Is the touch a campaign (utm or click id), as opposed to a plain referral? */
export const isCampaign = (t: Touch | undefined): boolean => !!t && !!(t.utm_source || t.click_id);
