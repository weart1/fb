/**
 * Flow (onboarding) definitions. The source of truth at runtime is Postgres (FlowDefinition),
 * editable in Settings. This default is used for seeding and as a fallback.
 *
 * NOTE: placeholder steps until the real /onboarding-3 step list is confirmed.
 */
export interface FlowStepDef {
  step: number;
  name: string;
  label: string;
  /** form fields on the step, by `name`/`id` attribute, for field-level analytics */
  fields: string[];
}

export interface FlowDef {
  id: string;
  path: string;
  label: string;
  steps: FlowStepDef[];
}

export const ONBOARDING_3: FlowDef = {
  id: 'onboarding-3',
  path: '/onboarding-3',
  label: 'Onboarding v3',
  steps: [
    { step: 1, name: 'intro', label: 'Intro', fields: [] },
    { step: 2, name: 'style', label: 'Style', fields: ['style_choice'] },
    { step: 3, name: 'goals', label: 'Goals', fields: ['goal', 'experience_level'] },
    { step: 4, name: 'details', label: 'Your details', fields: ['first_name', 'email', 'phone'] },
    { step: 5, name: 'plan', label: 'Choose plan', fields: ['plan_choice', 'billing_period'] },
    { step: 6, name: 'checkout', label: 'Checkout', fields: ['card_number', 'card_expiry', 'card_cvc', 'postal_code'] },
  ],
};
