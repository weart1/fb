/**
 * The fake ad account: campaigns → ad sets → ads (creatives) across Meta, Google and TikTok,
 * each with its own traffic share, quality and failure modes, so every report has a story to tell.
 */

export type Platform = 'meta' | 'google' | 'tiktok';

export interface Quality {
  /** probability a landed visitor leaves without interacting */
  bounce: number;
  /** multiplier per onboarding step transition, index = step that is being left (1..6) */
  stepMult?: Partial<Record<number, number>>;
  /** multiplier on time spent per step */
  speed?: number;
}

export interface Ad {
  id: string;
  name: string;
  creativeId: string;
  creativeName: string;
  format: 'video' | 'image' | 'carousel' | 'search';
  weight: number;
  quality?: Partial<Quality>;
}

export interface AdSet {
  id: string;
  name: string;
  weight: number;
  quality?: Partial<Quality>;
  ads: Ad[];
}

export interface Campaign {
  platform: Platform;
  id: string;
  name: string;
  /** share of paid sessions */
  weight: number;
  /** day offset (0 = first seeded day) the campaign starts / stops */
  startDay: number;
  endDay?: number;
  cpc: number;
  ctr: number;
  /** ad clicks that never become a recorded session (slow landing, closed webview, ad blockers) */
  clickLoss: number;
  quality: Quality;
  adsets: AdSet[];
}

const ad = (id: string, name: string, format: Ad['format'], weight: number, quality?: Partial<Quality>): Ad => ({
  id,
  name,
  creativeId: `cr_${id}`,
  creativeName: name,
  format,
  weight,
  ...(quality ? { quality } : {}),
});

export const CAMPAIGNS: Campaign[] = [
  {
    platform: 'meta',
    id: '120210000000001',
    name: 'ONB3 | Prospecting | Broad | US-EU',
    weight: 0.24,
    startDay: 0,
    cpc: 1.05,
    ctr: 0.014,
    clickLoss: 0.18,
    quality: { bounce: 0.44 },
    adsets: [
      {
        id: '120210000000101',
        name: 'Broad 25-44 | Advantage+',
        weight: 0.5,
        ads: [
          ad('120210000001001', 'UGC – "I sold my first print"', 'video', 0.45),
          ad('120210000001002', 'Static – Studio mockup', 'image', 0.3, { bounce: 0.55 }),
          ad('120210000001003', 'Carousel – 4 styles', 'carousel', 0.25, { stepMult: { 2: 1.08 } }),
        ],
      },
      {
        id: '120210000000102',
        name: 'Lookalike 5% – Purchasers',
        weight: 0.5,
        // story: this audience clicks a lot but abandons at the email field on step 4
        quality: { stepMult: { 4: 0.55 } },
        ads: [
          ad('120210000001004', 'UGC – "I sold my first print"', 'video', 0.6),
          ad('120210000001005', 'Static – Before/after', 'image', 0.4),
        ],
      },
    ],
  },
  {
    platform: 'meta',
    id: '120210000000002',
    name: 'ONB3 | Retargeting | Site visitors 30d',
    weight: 0.08,
    startDay: 0,
    cpc: 1.4,
    ctr: 0.021,
    clickLoss: 0.12,
    quality: { bounce: 0.3, stepMult: { 4: 1.15, 5: 1.1, 6: 1.15 } },
    adsets: [
      {
        id: '120210000000201',
        name: 'Visited onboarding, no purchase',
        weight: 1,
        ads: [
          ad('120210000002001', 'Offer – 50% off first month', 'image', 0.6, { stepMult: { 6: 1.2 } }),
          ad('120210000002002', 'Testimonial – carousel', 'carousel', 0.4),
        ],
      },
    ],
  },
  {
    platform: 'meta',
    id: '120210000000003',
    name: 'ONB3 | Reels | Creators',
    weight: 0.14,
    startDay: 21,
    cpc: 0.78,
    ctr: 0.011,
    clickLoss: 0.22,
    quality: { bounce: 0.5, speed: 0.85 },
    adsets: [
      {
        id: '120210000000301',
        name: 'Interests – Art & Design',
        weight: 0.6,
        ads: [
          ad('120210000003001', 'Reel – Speed paint to print', 'video', 0.55),
          ad('120210000003002', 'Reel – Creator interview', 'video', 0.45, { bounce: 0.6 }),
        ],
      },
      {
        id: '120210000000302',
        name: 'Interests – Etsy sellers',
        weight: 0.4,
        quality: { stepMult: { 5: 1.12, 6: 1.1 } },
        ads: [ad('120210000003003', 'Reel – Etsy vs weart studio', 'video', 1)],
      },
    ],
  },
  {
    platform: 'google',
    id: '21700000001',
    name: 'Search | Brand',
    weight: 0.08,
    startDay: 0,
    cpc: 0.62,
    ctr: 0.18,
    clickLoss: 0.06,
    quality: { bounce: 0.2, stepMult: { 1: 1.1, 2: 1.05, 3: 1.05, 4: 1.15, 5: 1.1, 6: 1.15 } },
    adsets: [
      {
        id: '15100000001',
        name: 'weart studio – exact',
        weight: 1,
        ads: [ad('69100000001', 'RSA – Brand', 'search', 1)],
      },
    ],
  },
  {
    platform: 'google',
    id: '21700000002',
    name: 'Search | Generic | Sell art online',
    weight: 0.14,
    startDay: 0,
    cpc: 2.3,
    ctr: 0.045,
    clickLoss: 0.08,
    quality: { bounce: 0.4, speed: 1.1 },
    adsets: [
      {
        id: '15100000002',
        name: 'sell art prints',
        weight: 0.55,
        ads: [ad('69100000002', 'RSA – Sell prints', 'search', 1)],
      },
      {
        id: '15100000003',
        name: 'print on demand art',
        weight: 0.45,
        quality: { stepMult: { 5: 0.85 } },
        ads: [ad('69100000003', 'RSA – Print on demand', 'search', 1)],
      },
    ],
  },
  {
    platform: 'tiktok',
    id: '1790000000001',
    name: 'TT | Spark Ads | Creators',
    weight: 0.2,
    startDay: 8,
    cpc: 0.55,
    ctr: 0.009,
    clickLoss: 0.28,
    // story: cheap clicks, high bounce, and the in-app browser struggles at checkout
    quality: { bounce: 0.64, speed: 0.75, stepMult: { 3: 0.92, 6: 0.7 } },
    adsets: [
      {
        id: '1790000000101',
        name: 'Broad 18-34',
        weight: 0.65,
        ads: [
          ad('1790000001001', 'Spark – "POV: your art on a hoodie"', 'video', 0.6),
          ad('1790000001002', 'Spark – Studio tour', 'video', 0.4, { bounce: 0.72 }),
        ],
      },
      {
        id: '1790000000102',
        name: 'Interest – Digital art',
        weight: 0.35,
        quality: { bounce: 0.56 },
        ads: [ad('1790000001003', 'In-feed – Tutorial hook', 'video', 1)],
      },
    ],
  },
  {
    platform: 'tiktok',
    id: '1790000000002',
    name: 'TT | Conversion | Lookalike',
    weight: 0.12,
    startDay: 30,
    endDay: 52,
    cpc: 0.68,
    ctr: 0.012,
    clickLoss: 0.25,
    quality: { bounce: 0.55, speed: 0.8, stepMult: { 6: 0.75 } },
    adsets: [
      {
        id: '1790000000201',
        name: 'LAL 3% – Signups',
        weight: 1,
        ads: [ad('1790000002001', 'Video – 3 styles in 15s', 'video', 1)],
      },
    ],
  },
];

/** Default onboarding transition probabilities: P(reach step n+1 | at step n). Key 6 = complete. */
export const STEP_CONTINUE: Record<number, number> = { 1: 0.74, 2: 0.86, 3: 0.84, 4: 0.55, 5: 0.6, 6: 0.48 };

/** Median seconds on each step (completers). */
export const STEP_TIME_S: Record<number, number> = { 1: 6, 2: 14, 3: 17, 4: 34, 5: 24, 6: 58 };

export const STEP_FIELDS: Record<number, string[]> = {
  2: ['style_choice'],
  3: ['goal', 'experience_level'],
  4: ['first_name', 'email', 'phone'],
  5: ['plan_choice', 'billing_period'],
  6: ['card_number', 'card_expiry', 'card_cvc', 'postal_code'],
};

export const STEP_NAMES: Record<number, string> = { 1: 'intro', 2: 'style', 3: 'goals', 4: 'details', 5: 'plan', 6: 'checkout' };

export const COUNTRIES: ReadonlyArray<readonly [string, number, string[], string]> = [
  ['US', 44, ['New York', 'Los Angeles', 'Chicago', 'Austin', 'Seattle', 'Miami'], 'en-US'],
  ['GB', 12, ['London', 'Manchester', 'Bristol'], 'en-GB'],
  ['CA', 8, ['Toronto', 'Vancouver', 'Montreal'], 'en-CA'],
  ['DE', 8, ['Berlin', 'Munich', 'Hamburg'], 'de-DE'],
  ['AU', 6, ['Sydney', 'Melbourne'], 'en-AU'],
  ['FR', 5, ['Paris', 'Lyon'], 'fr-FR'],
  ['NL', 3, ['Amsterdam', 'Rotterdam'], 'nl-NL'],
  ['ES', 3, ['Madrid', 'Barcelona'], 'es-ES'],
  ['IT', 3, ['Milan', 'Rome'], 'it-IT'],
  ['SE', 2, ['Stockholm'], 'sv-SE'],
  ['BR', 3, ['São Paulo', 'Rio de Janeiro'], 'pt-BR'],
  ['PL', 3, ['Warsaw', 'Kraków'], 'pl-PL'],
];

export interface DeviceProfile {
  device_type: 'mobile' | 'desktop' | 'tablet';
  browser: string;
  browser_version: string;
  os: string;
  os_version: string;
  in_app_browser: string;
  screen: [number, number];
  viewport: [number, number];
}

const IPHONE: Pick<DeviceProfile, 'os' | 'os_version' | 'screen' | 'viewport'> = { os: 'iOS', os_version: '17.5', screen: [390, 844], viewport: [390, 664] };
const ANDROID: Pick<DeviceProfile, 'os' | 'os_version' | 'screen' | 'viewport'> = { os: 'Android', os_version: '14', screen: [412, 915], viewport: [412, 780] };

export const DEVICES: Record<string, DeviceProfile> = {
  ig_ios: { device_type: 'mobile', browser: 'Instagram in-app', browser_version: '334', in_app_browser: 'instagram', ...IPHONE, viewport: [390, 640] },
  ig_android: { device_type: 'mobile', browser: 'Instagram in-app', browser_version: '334', in_app_browser: 'instagram', ...ANDROID },
  fb_ios: { device_type: 'mobile', browser: 'Facebook in-app', browser_version: '470', in_app_browser: 'facebook', ...IPHONE, viewport: [390, 630] },
  fb_android: { device_type: 'mobile', browser: 'Facebook in-app', browser_version: '470', in_app_browser: 'facebook', ...ANDROID },
  tt_ios: { device_type: 'mobile', browser: 'TikTok in-app', browser_version: '35', in_app_browser: 'tiktok', ...IPHONE, viewport: [390, 610] },
  tt_android: { device_type: 'mobile', browser: 'TikTok in-app', browser_version: '35', in_app_browser: 'tiktok', ...ANDROID },
  safari_ios: { device_type: 'mobile', browser: 'Safari', browser_version: '17', in_app_browser: '', ...IPHONE },
  chrome_android: { device_type: 'mobile', browser: 'Chrome', browser_version: '129', in_app_browser: '', ...ANDROID },
  ipad: { device_type: 'tablet', browser: 'Safari', browser_version: '17', in_app_browser: '', os: 'iOS', os_version: '17.5', screen: [820, 1180], viewport: [820, 1050] },
  chrome_win: { device_type: 'desktop', browser: 'Chrome', browser_version: '129', in_app_browser: '', os: 'Windows', os_version: '10', screen: [1920, 1080], viewport: [1536, 760] },
  chrome_mac: { device_type: 'desktop', browser: 'Chrome', browser_version: '129', in_app_browser: '', os: 'Mac OS', os_version: '10.15', screen: [1512, 982], viewport: [1440, 820] },
  safari_mac: { device_type: 'desktop', browser: 'Safari', browser_version: '17', in_app_browser: '', os: 'Mac OS', os_version: '10.15', screen: [1512, 982], viewport: [1440, 820] },
  edge_win: { device_type: 'desktop', browser: 'Edge', browser_version: '129', in_app_browser: '', os: 'Windows', os_version: '10', screen: [1920, 1080], viewport: [1536, 760] },
  firefox_win: { device_type: 'desktop', browser: 'Firefox', browser_version: '131', in_app_browser: '', os: 'Windows', os_version: '10', screen: [1920, 1080], viewport: [1536, 760] },
};

export const DEVICE_MIX: Record<'meta_fb' | 'meta_ig' | Platform | 'organic', ReadonlyArray<readonly [string, number]>> = {
  meta_ig: [['ig_ios', 50], ['ig_android', 28], ['safari_ios', 6], ['chrome_android', 4], ['chrome_win', 6], ['chrome_mac', 6]],
  meta_fb: [['fb_ios', 40], ['fb_android', 32], ['safari_ios', 6], ['chrome_android', 6], ['chrome_win', 10], ['chrome_mac', 6]],
  meta: [],
  tiktok: [['tt_ios', 45], ['tt_android', 40], ['safari_ios', 8], ['chrome_android', 5], ['chrome_win', 2]],
  google: [['safari_ios', 22], ['chrome_android', 24], ['ipad', 4], ['chrome_win', 22], ['chrome_mac', 14], ['safari_mac', 6], ['edge_win', 6], ['firefox_win', 2]],
  organic: [['safari_ios', 22], ['chrome_android', 20], ['ipad', 3], ['chrome_win', 25], ['chrome_mac', 18], ['safari_mac', 6], ['edge_win', 4], ['firefox_win', 2]],
};

export const PAGES = {
  home: { path: '/', title: 'weart studio – Turn your art into products' },
  onboarding: { path: '/onboarding-3', title: 'Get started – weart studio' },
  pricing: { path: '/pricing', title: 'Pricing – weart studio' },
  gallery: { path: '/gallery', title: 'Gallery – weart studio' },
  blog: { path: '/blog/how-to-sell-art-prints', title: 'How to sell art prints online – weart studio' },
  faq: { path: '/faq', title: 'FAQ – weart studio' },
  login: { path: '/login', title: 'Log in – weart studio' },
} as const;
export type PageKey = keyof typeof PAGES;

/** A/B test running on the style step. */
export const EXPERIMENT = { key: 'ob_style_step_layout', variants: ['control', 'grid'] as const, startDay: 14 };
