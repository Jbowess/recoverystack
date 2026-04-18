/**
 * API Cost Monitor
 *
 * Tracks API call volume and estimated spend across all external services.
 * Writes to `api_cost_log` and fires alerts when daily/monthly budgets
 * are exceeded or approaching limits.
 *
 * Services monitored:
 *   SerpAPI ($0.005/query), DataForSEO ($0.002/keyword), Ahrefs (credit-based),
 *   OpenAI (token-based), YouTube Data API (quota units), ClinicalTrials (free),
 *   App Store (free), Reddit (free with limits)
 *
 * Also computes ROI: revenue_attribution_usd / api_cost_usd per pipeline run.
 *
 * Circuit breaker: if daily spend exceeds DAILY_BUDGET_USD, the script writes
 * a CIRCUIT_BREAKER_ACTIVE flag to Supabase that pipeline steps check before
 * calling paid APIs.
 *
 * Usage:
 *   npx tsx scripts/api-cost-monitor.ts
 *   npx tsx scripts/api-cost-monitor.ts --reset-circuit-breaker
 *   npx tsx scripts/api-cost-monitor.ts --report
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sendPipelineAlert } from '@/lib/pipeline-alerts';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DAILY_BUDGET_USD = Number(process.env.API_DAILY_BUDGET_USD ?? 5.00);
const MONTHLY_BUDGET_USD = Number(process.env.API_MONTHLY_BUDGET_USD ?? 50.00);
const ALERT_AT_PCT = Number(process.env.API_ALERT_AT_PCT ?? 80); // alert at 80% of budget
const REPORT_MODE = process.argv.includes('--report');
const RESET_CIRCUIT_BREAKER = process.argv.includes('--reset-circuit-breaker');

// ── Cost per unit per API ─────────────────────────────────────────────────────
const API_COSTS: Record<string, { unit: string; cost_usd: number; daily_limit?: number }> = {
  serpapi: { unit: 'query', cost_usd: 0.005, daily_limit: 200 },
  dataforseo: { unit: 'keyword', cost_usd: 0.002, daily_limit: 500 },
  dataforseo_serp: { unit: 'task', cost_usd: 0.006, daily_limit: 100 },
  ahrefs: { unit: 'credit', cost_usd: 0.01, daily_limit: 100 },
  openai_gpt4: { unit: '1k_tokens', cost_usd: 0.030 },
  openai_gpt35: { unit: '1k_tokens', cost_usd: 0.002 },
  youtube_data: { unit: 'unit', cost_usd: 0, daily_limit: 10_000 }, // quota-based, not $
  google_rich_results: { unit: 'request', cost_usd: 0, daily_limit: 1000 }, // free
};

type CostLogRow = {
  service: string;
  operation: string;
  units: number;
  estimated_cost_usd: number;
  pipeline_run_id: string | null;
  recorded_at: string;
};

type DailySummary = {
  service: string;
  total_units: number;
  total_cost_usd: number;
  call_count: number;
};

// ── Fetch today's cost from log ───────────────────────────────────────────────
async function getTodayCosts(): Promise<DailySummary[]> {
  const today = new Date().toISOString().split('T')[0];

  const { data } = await supabase
    .from('api_cost_log')
    .select('service, units, estimated_cost_usd')
    .gte('recorded_at', today);

  if (!data) return [];

  const byService = new Map<string, DailySummary>();
  for (const row of data as Array<{ service: string; units: number; estimated_cost_usd: number }>) {
    const existing = byService.get(row.service) ?? {
      service: row.service,
      total_units: 0,
      total_cost_usd: 0,
      call_count: 0,
    };
    existing.total_units += row.units;
    existing.total_cost_usd += row.estimated_cost_usd;
    existing.call_count++;
    byService.set(row.service, existing);
  }

  return [...byService.values()];
}

// ── Fetch month-to-date costs ─────────────────────────────────────────────────
async function getMonthCosts(): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from('api_cost_log')
    .select('estimated_cost_usd')
    .gte('recorded_at', monthStart.toISOString());

  return (data ?? []).reduce((s, r: any) => s + (r.estimated_cost_usd ?? 0), 0);
}

// ── Check circuit breaker state ───────────────────────────────────────────────
async function isCircuitBreakerActive(): Promise<boolean> {
  const { data } = await supabase
    .from('system_flags')
    .select('value')
    .eq('key', 'api_circuit_breaker_active')
    .single();
  return (data as any)?.value === 'true';
}

async function setCircuitBreaker(active: boolean, reason: string): Promise<void> {
  await supabase.from('system_flags').upsert({
    key: 'api_circuit_breaker_active',
    value: String(active),
    metadata: { reason, set_at: new Date().toISOString() },
  }, { onConflict: 'key' });
}

// ── Compute ROI ───────────────────────────────────────────────────────────────
async function computeRoi(todayCostUsd: number): Promise<number | null> {
  const today = new Date().toISOString().split('T')[0];

  const { data } = await supabase
    .from('page_conversions')
    .select('revenue_usd, attribution_weight')
    .gte('converted_at', today);

  if (!data || data.length === 0) return null;

  const todayRevenue = (data as Array<{ revenue_usd: number; attribution_weight: number }>)
    .reduce((s, r) => s + r.revenue_usd * r.attribution_weight, 0);

  return todayCostUsd > 0 ? Math.round((todayRevenue / todayCostUsd) * 100) / 100 : null;
}

async function run(): Promise<void> {
  if (RESET_CIRCUIT_BREAKER) {
    await setCircuitBreaker(false, 'Manual reset');
    console.log('[api-cost] Circuit breaker reset.');
    return;
  }

  const todayCosts = await getTodayCosts();
  const totalTodayUsd = todayCosts.reduce((s, c) => s + c.total_cost_usd, 0);
  const totalMonthUsd = await getMonthCosts();
  const roi = await computeRoi(totalTodayUsd);
  const cbActive = await isCircuitBreakerActive();

  if (REPORT_MODE) {
    console.log('\n=== API Cost Report ===');
    console.log(`Daily spend:  $${totalTodayUsd.toFixed(4)} / $${DAILY_BUDGET_USD} budget (${Math.round(totalTodayUsd / DAILY_BUDGET_USD * 100)}%)`);
    console.log(`Monthly spend: $${totalMonthUsd.toFixed(2)} / $${MONTHLY_BUDGET_USD} budget (${Math.round(totalMonthUsd / MONTHLY_BUDGET_USD * 100)}%)`);
    if (roi !== null) console.log(`ROI today:    ${roi}x (revenue/cost)`);
    console.log(`Circuit breaker: ${cbActive ? 'ACTIVE ⚠️' : 'inactive ✓'}`);
    console.log('\nBy service:');

    for (const service of todayCosts.sort((a, b) => b.total_cost_usd - a.total_cost_usd)) {
      const limits = API_COSTS[service.service];
      const dailyPct = limits?.daily_limit
        ? Math.round((service.total_units / limits.daily_limit) * 100)
        : null;
      console.log(
        `  ${service.service.padEnd(20)}: ${service.call_count} calls, ${service.total_units} units, ` +
        `$${service.total_cost_usd.toFixed(4)}${dailyPct !== null ? ` (${dailyPct}% of daily limit)` : ''}`,
      );
    }
    return;
  }

  // Check daily budget
  const dailyPct = (totalTodayUsd / DAILY_BUDGET_USD) * 100;
  const monthlyPct = (totalMonthUsd / MONTHLY_BUDGET_USD) * 100;

  // Check per-service daily limits
  const overLimitServices: string[] = [];
  for (const service of todayCosts) {
    const limits = API_COSTS[service.service];
    if (limits?.daily_limit && service.total_units > limits.daily_limit) {
      overLimitServices.push(`${service.service} (${service.total_units}/${limits.daily_limit})`);
    }
  }

  // Write daily snapshot
  await supabase.from('api_cost_snapshots').upsert({
    snapshot_date: new Date().toISOString().split('T')[0],
    total_cost_usd: Math.round(totalTodayUsd * 10000) / 10000,
    monthly_cost_usd: Math.round(totalMonthUsd * 100) / 100,
    budget_daily_usd: DAILY_BUDGET_USD,
    budget_monthly_usd: MONTHLY_BUDGET_USD,
    daily_pct_used: Math.round(dailyPct * 10) / 10,
    monthly_pct_used: Math.round(monthlyPct * 10) / 10,
    roi: roi,
    service_breakdown: Object.fromEntries(todayCosts.map((c) => [c.service, { cost: c.total_cost_usd, units: c.total_units }])),
    circuit_breaker_active: cbActive,
    over_limit_services: overLimitServices,
    recorded_at: new Date().toISOString(),
  }, { onConflict: 'snapshot_date' });

  // Activate circuit breaker if budget exceeded
  if (totalTodayUsd >= DAILY_BUDGET_USD && !cbActive) {
    await setCircuitBreaker(true, `Daily budget exceeded: $${totalTodayUsd.toFixed(4)} >= $${DAILY_BUDGET_USD}`);
    await sendPipelineAlert({
      pipeline: 'api-cost-monitor',
      step: 'circuit-breaker',
      status: 'failed',
      message: `CIRCUIT BREAKER ACTIVATED: Daily API spend $${totalTodayUsd.toFixed(4)} exceeded budget $${DAILY_BUDGET_USD}.\nPaid API calls will be blocked until budget resets or manual override.`,
      durationMs: 0,
    });
    console.log(`[api-cost] CIRCUIT BREAKER ACTIVATED — daily spend $${totalTodayUsd.toFixed(4)} exceeds $${DAILY_BUDGET_USD} budget`);
    return;
  }

  // Budget warning alerts
  if (dailyPct >= ALERT_AT_PCT && dailyPct < 100) {
    await sendPipelineAlert({
      pipeline: 'api-cost-monitor',
      step: 'budget-warning',
      status: 'warning',
      message: `API budget at ${Math.round(dailyPct)}% for today ($${totalTodayUsd.toFixed(4)}/$${DAILY_BUDGET_USD})`,
      durationMs: 0,
    });
  }

  if (overLimitServices.length > 0) {
    console.warn(`[api-cost] Services over daily limit: ${overLimitServices.join(', ')}`);
  }

  console.log(
    `[api-cost] Today: $${totalTodayUsd.toFixed(4)} (${Math.round(dailyPct)}% of $${DAILY_BUDGET_USD} budget) | ` +
    `Month: $${totalMonthUsd.toFixed(2)} (${Math.round(monthlyPct)}%) | ` +
    `ROI: ${roi !== null ? roi + 'x' : 'N/A'} | CB: ${cbActive ? 'ACTIVE' : 'off'}`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
