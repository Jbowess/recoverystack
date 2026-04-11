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
  status: string;
  updated_at: string | null;
  published_at: string | null;
  created_at: string | null;
  search_volume: number | null;
};

const STALE_DAYS = Number(process.env.CONTENT_REFRESH_STALE_DAYS ?? 90);
const LOW_TRAFFIC_THRESHOLD = Number(process.env.CONTENT_REFRESH_LOW_TRAFFIC_THRESHOLD ?? 0);

function daysSince(dateIso: string, nowMs: number) {
  const createdMs = new Date(dateIso).getTime();
  return (nowMs - createdMs) / (1000 * 60 * 60 * 24);
}

function getFreshnessAnchor(page: PageForRefreshCheck) {
  return page.updated_at ?? page.published_at ?? page.created_at;
}

function shouldQueueForRefresh(page: PageForRefreshCheck, nowMs: number) {
  const anchor = getFreshnessAnchor(page);
  if (!anchor) return null;

  const pageAgeDays = daysSince(anchor, nowMs);
  if (pageAgeDays < STALE_DAYS) return null;

  const lowTraffic = typeof page.search_volume === 'number' && page.search_volume <= LOW_TRAFFIC_THRESHOLD;

  return {
    pageAgeDays,
    lowTraffic,
    reason: lowTraffic
      ? `stale_${STALE_DAYS}d_low_traffic`
      : `stale_${STALE_DAYS}d`,
  };
}

async function loadRefreshCandidates(limit = 500): Promise<PageForRefreshCheck[]> {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,status,updated_at,published_at,created_at,search_volume')
    .in('status', ['published', 'draft'])
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as PageForRefreshCheck[];
}

async function enqueueRefresh(page: PageForRefreshCheck, evaluation: { pageAgeDays: number; lowTraffic: boolean; reason: string }) {
  const payload = {
    page_id: page.id,
    slug: page.slug,
    reason: evaluation.reason,
    stale_days: Math.floor(evaluation.pageAgeDays),
    low_traffic: evaluation.lowTraffic,
    search_volume_snapshot: page.search_volume,
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

  let queued = 0;
  const nowMs = Date.now();

  for (const page of pages) {
    const evaluation = shouldQueueForRefresh(page, nowMs);
    if (!evaluation) continue;

    await enqueueRefresh(page, evaluation);
    queued += 1;
  }

  console.log(
    `Content refresh sweep complete. Evaluated ${pages.length} page(s); queued/upserted ${queued} stale page(s) (threshold=${STALE_DAYS}d, low-traffic<=${LOW_TRAFFIC_THRESHOLD}).`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
