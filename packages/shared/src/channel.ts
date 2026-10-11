import type { ClickIdType } from './events';

export type Channel =
  | 'paid_social'
  | 'paid_search'
  | 'paid_video'
  | 'paid_other'
  | 'organic_social'
  | 'organic_search'
  | 'email'
  | 'referral'
  | 'direct';

const SOCIAL = /(^|\.)(facebook|fb|instagram|ig|tiktok|t\.co|twitter|x|linkedin|lnkd|pinterest|reddit|snapchat|threads|youtube|vk|telegram)\b/i;
const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia|brave)\./i;
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paid_?social|paid_?search|display|banner|ads?|retargeting|paidsocial)$/i;

export interface ChannelInput {
  utm_source?: string | undefined;
  utm_medium?: string | undefined;
  click_id_type?: ClickIdType | undefined;
  referrer_domain?: string | undefined;
}

/** Channel grouping, similar to GA4 default channel groups, tuned for paid social. */
export function classifyChannel(i: ChannelInput): Channel {
  const src = (i.utm_source ?? '').toLowerCase();
  const med = (i.utm_medium ?? '').toLowerCase();
  const ref = (i.referrer_domain ?? '').toLowerCase();

  if (i.click_id_type === 'gclid' || i.click_id_type === 'wbraid' || i.click_id_type === 'gbraid' || i.click_id_type === 'msclkid') {
    return src.includes('youtube') ? 'paid_video' : 'paid_search';
  }
  if (i.click_id_type === 'fbclid' && (PAID_MEDIUM.test(med) || src !== '')) return 'paid_social';
  if (i.click_id_type === 'ttclid') return 'paid_social';

  if (med && PAID_MEDIUM.test(med)) {
    if (SOCIAL.test(src) || /social/.test(med)) return src.includes('youtube') ? 'paid_video' : 'paid_social';
    if (SEARCH.test(`${src}.`) || /search|cpc|ppc/.test(med)) return 'paid_search';
    return 'paid_other';
  }
  if (med === 'email' || src === 'email' || /newsletter/.test(src)) return 'email';
  if (med === 'social' || med === 'organic_social' || (src && SOCIAL.test(src))) return 'organic_social';
  // fbclid without utm is usually an organic share on FB/IG (Meta appends it to all outbound links)
  if (i.click_id_type === 'fbclid') return 'organic_social';
  if (ref) {
    if (SEARCH.test(`${ref}.`) || SEARCH.test(ref)) return 'organic_search';
    if (SOCIAL.test(ref)) return 'organic_social';
    return 'referral';
  }
  if (src) return 'referral';
  return 'direct';
}

/** Normalized ad platform from source / click id. */
export type AdPlatform = 'meta' | 'google' | 'tiktok' | 'other' | '';
export function adPlatform(utmSource: string | undefined, clickIdType: ClickIdType | undefined): AdPlatform {
  const s = (utmSource ?? '').toLowerCase();
  if (clickIdType === 'gclid' || clickIdType === 'wbraid' || clickIdType === 'gbraid' || /google|youtube/.test(s)) return 'google';
  if (clickIdType === 'ttclid' || /tiktok/.test(s)) return 'tiktok';
  if (/facebook|instagram|^fb$|^ig$|meta|messenger|audience_network/.test(s) || (clickIdType === 'fbclid' && s !== '')) return 'meta';
  if (s) return 'other';
  return '';
}

export function domainOf(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
