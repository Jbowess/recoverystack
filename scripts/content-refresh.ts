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
    status: 'queued',
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
  const nowMs = Date.now();

  for (const page of pages) {
    const gsc = gscMap.get(page.slug) ?? null;
    const evaluation = shouldQueueForRefresh(page, nowMs, gsc);
    if (!evaluation) continue;

    await enqueueRefresh(page, evaluation);
    queued += 1;
  }

  console.log(
    `Content refresh sweep complete. Evaluated ${pages.length} page(s); queued/upserted ${queued} stale page(s) (threshold=${STALE_DAYS}d, low-traffic<=${LOW_TRAFFIC_THRESHOLD}, GSC data for ${gscMap.size} pages).`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
