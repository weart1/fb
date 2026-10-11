/** Mirrors apps/ingest ConversionJob (the queue contract). */
export interface ConversionJob {
  project_id: string;
  event_id: string;
  event: string;
  ts: number;
  url: string;
  anonymous_id: string;
  user_id: string;
  click_id_type: string;
  click_id: string;
  utm_source: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  revenue: number;
  currency: string;
  order_id: string;
  email_hash: string;
  phone_hash: string;
  user_agent: string;
  client_ip?: string;
  country: string;
}

export interface SendResult {
  status: 'sent' | 'dry_run' | 'skipped' | 'failed';
  response?: string;
}

export interface Destination<C> {
  /** Platform request (url + body), or null when the event cannot be matched on this platform. */
  build(job: ConversionJob, platformEvent: string, creds: C): { url: string; headers: Record<string, string>; body: unknown } | null;
}
