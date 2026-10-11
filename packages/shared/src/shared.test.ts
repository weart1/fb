import { describe, expect, it } from 'vitest';
import { adPlatform, bucket, classifyChannel, detectInAppBrowser, domainOf, isBotUserAgent } from './index';

describe('classifyChannel', () => {
  it('meta ads with utm + fbclid are paid_social', () => {
    expect(classifyChannel({ utm_source: 'facebook', utm_medium: 'paid_social', click_id_type: 'fbclid' })).toBe('paid_social');
  });
  it('fbclid without utm is an organic share', () => {
    expect(classifyChannel({ click_id_type: 'fbclid', referrer_domain: 'l.facebook.com' })).toBe('organic_social');
  });
  it('gclid is paid_search', () => {
    expect(classifyChannel({ click_id_type: 'gclid' })).toBe('paid_search');
  });
  it('tiktok cpc is paid_social', () => {
    expect(classifyChannel({ utm_source: 'tiktok', utm_medium: 'cpc' })).toBe('paid_social');
  });
  it('google referrer without params is organic_search', () => {
    expect(classifyChannel({ referrer_domain: 'google.com' })).toBe('organic_search');
  });
  it('unknown referrer is referral, nothing is direct', () => {
    expect(classifyChannel({ referrer_domain: 'blog.example.com' })).toBe('referral');
    expect(classifyChannel({})).toBe('direct');
  });
});

describe('adPlatform', () => {
  it('maps sources', () => {
    expect(adPlatform('instagram', 'fbclid')).toBe('meta');
    expect(adPlatform(undefined, 'gclid')).toBe('google');
    expect(adPlatform('tiktok', undefined)).toBe('tiktok');
    expect(adPlatform(undefined, undefined)).toBe('');
  });
});

describe('detectInAppBrowser', () => {
  it('detects instagram, facebook, tiktok webviews', () => {
    expect(
      detectInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98',
      ),
    ).toBe('instagram');
    expect(
      detectInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.43.109;FBBV/1]',
      ),
    ).toBe('facebook');
    expect(
      detectInAppBrowser(
        'Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36 trill_350003 BytedanceWebview/d8a21c6',
      ),
    ).toBe('tiktok');
  });
  it('regular browsers are not in-app', () => {
    expect(detectInAppBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe('');
  });
});

describe('isBotUserAgent', () => {
  it('flags crawlers and headless', () => {
    expect(isBotUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe(false);
  });
});

describe('bucket', () => {
  it('is deterministic and in [0,1)', () => {
    const b = bucket('exp', 'abc');
    expect(b).toBe(bucket('exp', 'abc'));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(1);
  });
  it('is roughly uniform', () => {
    let low = 0;
    for (let i = 0; i < 10000; i++) if (bucket('s', `id-${i}`) < 0.5) low++;
    expect(low).toBeGreaterThan(4700);
    expect(low).toBeLessThan(5300);
  });
});

it('domainOf strips www', () => {
  expect(domainOf('https://www.Google.com/search?q=1')).toBe('google.com');
  expect(domainOf('not a url')).toBe('');
});
