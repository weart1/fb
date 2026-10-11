/**
 * In-app browser detection. Paid social traffic mostly arrives inside these webviews,
 * which behave differently (no third-party cookies, odd viewport, broken payment popups),
 * so they get their own dimension instead of being lumped into "Mobile Safari"/"Chrome WebView".
 */
export type InAppBrowser =
  | 'instagram'
  | 'facebook'
  | 'messenger'
  | 'tiktok'
  | 'snapchat'
  | 'pinterest'
  | 'linkedin'
  | 'twitter'
  | 'telegram'
  | 'line'
  | 'wechat'
  | 'other_webview'
  | '';

const RULES: ReadonlyArray<[RegExp, InAppBrowser]> = [
  [/Instagram/i, 'instagram'],
  [/\bFB_IAB\b|FBAN\/Messenger|MessengerForiOS|\bOrca-Android\b/i, 'messenger'],
  [/FBAN|FBAV|FB_IAB|FBIOS|\[FB/i, 'facebook'],
  [/musical_ly|BytedanceWebview|TikTok|trill_|aweme/i, 'tiktok'],
  [/Snapchat/i, 'snapchat'],
  [/Pinterest/i, 'pinterest'],
  [/LinkedInApp/i, 'linkedin'],
  [/Twitter/i, 'twitter'],
  [/Telegram/i, 'telegram'],
  [/\bLine\//i, 'line'],
  [/MicroMessenger/i, 'wechat'],
];

export function detectInAppBrowser(ua: string): InAppBrowser {
  for (const [re, name] of RULES) {
    // Messenger rule must not swallow plain Facebook app UAs
    if (name === 'messenger' && /FB_IAB/.test(ua) && !/Messenger|Orca/i.test(ua)) continue;
    if (re.test(ua)) return name;
  }
  if (/; wv\)/.test(ua) || /\bWebView\b/i.test(ua)) return 'other_webview';
  return '';
}

const BOT_RE =
  /bot|crawl|spider|slurp|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|axios\/|node-fetch|go-http-client|java\/|okhttp|facebookexternalhit|facebookcatalog|meta-externalagent|adsbot|mediapartners|bytespider|preview|prerender|scrapy|httpclient|apache-httpclient/i;

/** Server-side bot check. Note: facebookexternalhit is the link-preview crawler, not a human click. */
export function isBotUserAgent(ua: string | undefined): boolean {
  if (!ua || ua.length < 20) return true;
  return BOT_RE.test(ua);
}
