/**
 * Core Web Vitals monitor — queries the Chrome UX Report (CrUX) API for
 * origin-level LCP, CLS, and INP p75 metrics and writes a daily row to the
 * core_web_vitals table.
 *
 * Required env:
 *   CRUX_API_KEY — Google CrUX API key (free, from Google Cloud Console)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — standard Supabase vars
 *   SITE_URL — site origin to query (default: https://recoverystack.io)
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const SITE_ORIGIN = new URL(process.env.SITE_URL ?? 'https://recoverystack.io').origin;
const CRUX_API_KEY = process.env.CRUX_API_KEY;

type MetricData = {
  histogram: Array<{ start: number; end?: number; density: number }>;
  percentiles: { p75: number };
};

type CruxResponse = {
  record?: {
    metrics?: {
      largest_contentful_paint?: MetricData;
      cumulative_layout_shift?: MetricData;
      interaction_to_next_paint?: MetricData;
    };
  };
};

function rateMetric(metric: 'lcp' | 'cls' | 'inp', value: number): string {
  if (metric === 'lcp') {
    if (value <= 2500) return 'good';
    if (value <= 4000) return 'needs_improvement';
    return 'poor';
  }
  if (metric === 'cls') {
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs_improvement';
    return 'poor';
  }
  // INP
  if (value <= 200) return 'good';
  if (value <= 500) return 'needs_improvement';
  return 'poor';
}

async function fetchCruxData(): Promise<CruxResponse | null> {
  if (!CRUX_API_KEY) {
    console.log('[cwv-monitor] CRUX_API_KEY not set — skipping CrUX fetch, writing placeholder row.');
    return null;
  }

  const res = await fetch(
    `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${CRUX_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: SITE_ORIGIN,
        formFactor: 'PHONE',
        metrics: ['largest_contentful_paint', 'cumulative_layout_shift', 'interaction_to_next_paint'],
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) {
      console.warn(`[cwv-monitor] No CrUX data available for ${SITE_ORIGIN} yet — site may need more traffic.`);
      return null;
    }
    throw new Error(`CrUX API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<CruxResponse>;
}

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await fetchCruxData();

  const metrics = data?.record?.metrics;
  const lcpP75 = metrics?.largest_contentful_paint?.percentiles?.p75 ?? null;
  const clsP75 = metrics?.cumulative_layout_shift?.percentiles?.p75 ?? null;
  const inpP75 = metrics?.interaction_to_next_paint?.percentiles?.p75 ?? null;

  const row = {
    recorded_at: today,
    lcp_p75: lcpP75,
    cls_p75: clsP75,
    inp_p75: inpP75,
    lcp_rating: lcpP75 != null ? rateMetric('lcp', lcpP75) : null,
    cls_rating: clsP75 != null ? rateMetric('cls', clsP75) : null,
    inp_rating: inpP75 != null ? rateMetric('inp', inpP75) : null,
    raw: data ?? null,
  };

  const { error } = await supabase
    .from('core_web_vitals')
    .upsert(row, { onConflict: 'recorded_at' });

  if (error) {
    throw new Error(`Failed to write CWV row: ${error.message}`);
  }

  // Warn if any metric is in a bad band
  const warnings: string[] = [];
  if (row.lcp_rating === 'poor') warnings.push(`LCP p75 = ${lcpP75}ms (POOR — threshold: ≤2500ms good)`);
  if (row.lcp_rating === 'needs_improvement') warnings.push(`LCP p75 = ${lcpP75}ms (needs improvement — threshold: ≤2500ms good)`);
  if (row.cls_rating === 'poor') warnings.push(`CLS p75 = ${clsP75} (POOR — threshold: ≤0.1 good)`);
  if (row.cls_rating === 'needs_improvement') warnings.push(`CLS p75 = ${clsP75} (needs improvement)`);
  if (row.inp_rating === 'poor') warnings.push(`INP p75 = ${inpP75}ms (POOR — threshold: ≤200ms good)`);
  if (row.inp_rating === 'needs_improvement') warnings.push(`INP p75 = ${inpP75}ms (needs improvement)`);

  for (const w of warnings) {
    console.warn(`[cwv-monitor] WARNING: ${w}`);
  }

  console.log(
    `[cwv-monitor] Recorded CWV for ${today}: LCP=${lcpP75 ?? 'n/a'}ms (${row.lcp_rating ?? 'n/a'}), CLS=${clsP75 ?? 'n/a'} (${row.cls_rating ?? 'n/a'}), INP=${inpP75 ?? 'n/a'}ms (${row.inp_rating ?? 'n/a'})`,
  );
}

run().catch((err) => {
  console.error('[cwv-monitor] Failed:', err);
  process.exit(1);
});
