import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

type PageForRefreshCheck = {
  id: string;
  slug: string;
  template: string;
  status: string;
  updated_at: string | null;
  published_at: string | null;
  created_at: string | null;
  search_volume: number | null;
};

type GscMetrics = {
  page_slug: string;
  impressions: number;
  clicks: number;
  avg_position: number;
};

const STALE_DAYS = Number(process.env.CONTENT_REFRESH_STALE_DAYS ?? 45);
const LOW_TRAFFIC_THRESHOLD = Number(process.env.CONTENT_REFRESH_LOW_TRAFFIC_THRESHOLD ?? 10);

// Auto-approve thresholds — when metrics cross these deltas, skip manual review
// and mark the refresh item directly as 'approved' for nightly processing.
const AUTO_APPROVE_POSITION_DROP = Number(process.env.REFRESH_AUTO_APPROVE_POSITION_DROP ?? 5);   // positions dropped
const AUTO_APPROVE_CTR_DROP_PCT = Number(process.env.REFRESH_AUTO_APPROVE_CTR_DROP_PCT ?? 20);     // % CTR drop
const AUTO_APPROVE_IMPRESSION_DROP_PCT = Number(process.env.REFRESH_AUTO_APPROVE_IMPRESSION_DROP_PCT ?? 50); // % impressions drop

function daysSince(dateIso: string, nowMs: number) {
  const createdMs = new Date(dateIso).getTime();
  return (nowMs - createdMs) / (1000 * 60 * 60 * 24);
}

function getFreshnessAnchor(page: PageForRefreshCheck) {
  return page.updated_at ?? page.published_at ?? page.created_at;
}

function shouldQueueForRefresh(page: PageForRefreshCheck, nowMs: number, gsc?: GscMetrics | null) {
  const anchor = getFreshnessAnchor(page);
  if (!anchor) return null;

  const pageAgeDays = daysSince(anchor, nowMs);
  if (pageAgeDays < STALE_DAYS) return null;

  // Use real GSC data when available, fall back to search_volume estimate
  const realClicks = gsc?.clicks ?? null;
  const realImpressions = gsc?.impressions ?? null;
  const realPosition = gsc?.avg_position ?? null;

  const lowTraffic = realClicks !== null
    ? realClicks <= LOW_TRAFFIC_THRESHOLD
    : (typeof page.search_volume === 'number' && page.search_volume <= LOW_TRAFFIC_THRESHOLD);

  // Declining page: has impressions but poor position (> 20) or zero clicks
  const declining = realPosition !== null && realPosition > 20 && (realClicks ?? 0) < 5;

  // Priority scoring: incorporate real performance data
  const ageFactor = Math.min(pageAgeDays / 180, 1);         // caps at ~6 months
  const trafficFactor = lowTraffic ? 1 : 0.3;
  const declineFactor = declining ? 0.3 : 0;
  // Pages with impressions but no clicks = high priority (they're being shown but not clicked)
  const ctrFactor = (realImpressions ?? 0) > 50 && (realClicks ?? 0) < 3 ? 0.2 : 0;
  const priority = Math.round((ageFactor * 0.4 + trafficFactor * 0.25 + declineFactor + ctrFactor) * 100);

  let reason = `stale_${STALE_DAYS}d`;
  if (declining) reason = `declining_position_${Math.round(realPosition!)}`;
  else if (ctrFactor > 0) reason = `low_ctr_high_impressions`;
  else if (lowTraffic) reason += '_low_traffic';

  return {
    pageAgeDays,
    lowTraffic,
    declining,
    priority,
    reason,
    gscClicks: realClicks,
    gscImpressions: realImpressions,
    gscPosition: realPosition,
  };
}

async function loadRefreshCandidates(limit = 500): Promise<PageForRefreshCheck[]> {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,status,updated_at,published_at,created_at,search_volume')
    .in('status', ['published', 'draft'])
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as PageForRefreshCheck[];
}

type DailyMetricRow = {
  date: string;
  position: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
};

/**
 * Returns week-over-week deltas for a slug using page_metrics_daily.
 * Compares most recent 7 days vs prior 7 days.
 */
async function getWeeklyDeltas(slug: string): Promise<{
  positionDelta: number | null;
  ctrDropPct: number | null;
  impressionDropPct: number | null;
} | null> {
  const { data, error } = await supabase
    .from('page_metrics_daily')
    .select('date,position,clicks,impressions,ctr')
    .eq('page_slug', slug)
    .order('date', { ascending: false })
    .limit(14);

  if (error || !data || data.length < 7) return null;

  const rows = data as DailyMetricRow[];
  const recent = rows.slice(0, 7);
  const prior = rows.slice(7, 14);
  if (prior.length < 7) return null;

  const avg = (vals: (number | null)[]): number | null => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };

  const recentPos = avg(recent.map((r) => r.position));
  const priorPos = avg(prior.map((r) => r.position));
  const recentCtr = avg(recent.map((r) => r.ctr));
  const priorCtr = avg(prior.map((r) => r.ctr));
  const recentImp = avg(recent.map((r) => r.impressions));
  const priorImp = avg(prior.map((r) => r.impressions));

  const positionDelta = recentPos != null && priorPos != null ? recentPos - priorPos : null;
  const ctrDropPct = recentCtr != null && priorCtr != null && priorCtr > 0
    ? ((priorCtr - recentCtr) / priorCtr) * 100
    : null;
  const impressionDropPct = recentImp != null && priorImp != null && priorImp > 0
    ? ((priorImp - recentImp) / priorImp) * 100
    : null;

  return { positionDelta, ctrDropPct, impressionDropPct };
}

async function loadGscMetrics(slugs: string[]): Promise<Map<string, GscMetrics>> {
  const map = new Map<string, GscMetrics>();
  if (slugs.length === 0) return map;

  // Fetch latest GSC metrics for these slugs (from gsc_metrics table written by gsc-sync)
  const { data, error } = await supabase
    .from('gsc_metrics')
    .select('page_slug,impressions,clicks,avg_position')
    .in('page_slug', slugs);

  if (error) {
    console.warn(`[content-refresh] Could not load GSC metrics: ${error.message}`);
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.page_slug, row as GscMetrics);
  }
  return map;
}

async function enqueueRefresh(
  page: PageForRefreshCheck,
  evaluation: { pageAgeDays: number; lowTraffic: boolean; reason: string; priority: number; gscClicks?: number | null; gscPosition?: number | null },
  autoApprove = false,
) {
  const payload = {
    page_id: page.id,
    slug: page.slug,
    reason: evaluation.reason,
    stale_days: Math.floor(evaluation.pageAgeDays),
    low_traffic: evaluation.lowTraffic,
    search_volume_snapshot: page.search_volume,
    gsc_clicks: evaluation.gscClicks ?? null,
    gsc_position: evaluation.gscPosition ? Math.round(evaluation.gscPosition) : null,
    priority: evaluation.priority,
    status: autoApprove ? 'approved' : 'queued',
    queued_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('content_refresh_queue')
    .upsert(payload, { onConflict: 'page_id' });

  if (error) throw error;
}

async function run() {
  const pages = await loadRefreshCandidates();
  if (!pages.length) {
    console.log('No pages found for content refresh check.');
    return;
  }

  // Load real GSC performance data for all candidate pages
  const gscMap = await loadGscMetrics(pages.map((p) => p.slug));
  console.log(`Loaded GSC metrics for ${gscMap.size} of ${pages.length} pages.`);

  let queued = 0;
  let autoApproved = 0;
  const nowMs = Date.now();

  for (const page of pages) {
    const gsc = gscMap.get(page.slug) ?? null;
    const evaluation = shouldQueueForRefresh(page, nowMs, gsc);
    if (!evaluation) continue;

    // Check week-over-week decay signals for auto-approve
    const deltas = await getWeeklyDeltas(page.slug);
    let autoApprove = false;
    if (deltas) {
      const positionDecayed = deltas.positionDelta != null && deltas.positionDelta > AUTO_APPROVE_POSITION_DROP;
      const ctrDecayed = deltas.ctrDropPct != null && deltas.ctrDropPct >= AUTO_APPROVE_CTR_DROP_PCT;
      const impressionsDecayed = deltas.impressionDropPct != null && deltas.impressionDropPct >= AUTO_APPROVE_IMPRESSION_DROP_PCT;
      autoApprove = positionDecayed || ctrDecayed || impressionsDecayed;

      if (autoApprove) {
        const reasons: string[] = [];
        if (positionDecayed) reasons.push(`position+${deltas.positionDelta!.toFixed(1)}`);
        if (ctrDecayed) reasons.push(`ctr-${deltas.ctrDropPct!.toFixed(0)}%`);
        if (impressionsDecayed) reasons.push(`impressions-${deltas.impressionDropPct!.toFixed(0)}%`);
        evaluation.reason = `${evaluation.reason}|auto_decay:${reasons.join(',')}`;
        autoApproved += 1;
      }
    }

    await enqueueRefresh(page, evaluation, autoApprove);
    queued += 1;
  }

  console.log(
    `Content refresh sweep complete. Evaluated ${pages.length} page(s); queued/upserted ${queued} stale page(s) (${autoApproved} auto-approved via decay detection; threshold=${STALE_DAYS}d, low-traffic<=${LOW_TRAFFIC_THRESHOLD}, GSC data for ${gscMap.size} pages).`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
