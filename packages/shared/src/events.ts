/** Event names captured automatically by the SDK. `$` prefix = system event. */
export const SystemEvent = {
  Pageview: '$pageview',
  Pageleave: '$pageleave',
  ScrollDepth: '$scroll_depth',
  Click: '$click',
  RageClick: '$rage_click',
  DeadClick: '$dead_click',
  FieldFocus: '$form_field_focus',
  FieldBlur: '$form_field_blur',
  FieldError: '$form_field_error',
  FormSubmit: '$form_submit',
  FormAbandon: '$form_abandon',
  Error: '$error',
  NetworkError: '$network_error',
  WebVital: '$web_vital',
  Identify: '$identify',
  Consent: '$consent',
  Exposure: '$exposure',
  Revenue: '$revenue',
  MoveMap: '$move_map',
} as const;
export type SystemEventName = (typeof SystemEvent)[keyof typeof SystemEvent];

/** Onboarding / flow events. All carry flow_id, step, step_name. */
export const FlowEvent = {
  Started: 'onboarding_started',
  StepViewed: 'onboarding_step_viewed',
  StepCompleted: 'onboarding_step_completed',
  StepError: 'onboarding_step_error',
  StepBack: 'onboarding_step_back',
  Completed: 'onboarding_completed',
  Abandoned: 'onboarding_abandoned',
} as const;
export type FlowEventName = (typeof FlowEvent)[keyof typeof FlowEvent];

/** Business conversions forwarded to ad platforms (CAPI etc.). */
export const ConversionEvent = {
  SignUp: 'sign_up',
  Purchase: 'purchase',
  OnboardingCompleted: FlowEvent.Completed,
} as const;

export const WEB_VITALS = ['LCP', 'INP', 'CLS', 'TTFB', 'FCP'] as const;
export type WebVitalName = (typeof WEB_VITALS)[number];

export const CLICK_ID_PARAMS = ['fbclid', 'gclid', 'ttclid', 'wbraid', 'gbraid', 'msclkid'] as const;
export type ClickIdType = (typeof CLICK_ID_PARAMS)[number];

export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
/** Ad hierarchy IDs passed via URL templates (see docs/ADS_URL_TEMPLATES.md). */
export const AD_ID_PARAMS = ['campaign_id', 'adset_id', 'ad_id', 'creative_id'] as const;
