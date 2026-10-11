import { detectInAppBrowser } from '@weart/shared';
import { UAParser } from 'ua-parser-js';
import { LRUCache } from 'lru-cache';

export interface ParsedUA {
  device_type: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  in_app_browser: string;
}

// The same handful of UA strings repeat across a burst of ad traffic; parsing is the hot path.
const cache = new LRUCache<string, ParsedUA>({ max: 5000 });

export function parseUA(ua: string): ParsedUA {
  const hit = cache.get(ua);
  if (hit) return hit;
  const r = new UAParser(ua).getResult();
  const inApp = detectInAppBrowser(ua);
  const t = r.device.type;
  const parsed: ParsedUA = {
    device_type: t === 'tablet' ? 'tablet' : t === 'mobile' || t === 'wearable' || t === 'embedded' ? 'mobile' : /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
    browser: inApp ? inAppLabel(inApp) : (r.browser.name ?? 'Unknown').replace(/^Mobile /, ''),
    browser_version: (r.browser.major ?? '').slice(0, 16),
    os: r.os.name ?? 'Unknown',
    os_version: (r.os.version ?? '').split('.').slice(0, 2).join('.'),
    in_app_browser: inApp,
  };
  cache.set(ua, parsed);
  return parsed;
}

const LABELS: Record<string, string> = {
  instagram: 'Instagram in-app',
  facebook: 'Facebook in-app',
  messenger: 'Messenger in-app',
  tiktok: 'TikTok in-app',
  snapchat: 'Snapchat in-app',
  pinterest: 'Pinterest in-app',
  linkedin: 'LinkedIn in-app',
  twitter: 'X in-app',
  telegram: 'Telegram in-app',
  line: 'LINE in-app',
  wechat: 'WeChat in-app',
  other_webview: 'WebView',
};
const inAppLabel = (k: string): string => LABELS[k] ?? 'WebView';
