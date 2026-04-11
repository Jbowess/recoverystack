import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

type QueueMetricRow = {
  id: string;
  cluster_name: string;
  status: 'new' | 'queued' | 'generated' | 'published' | 'skipped';
  metadata: Record<string, unknown> | null;
  primary_keyword: string;
};

type PageMetricRow = {
  slug: string;
  status: string;
  body_json: Record<string, unknown> | null;
  schema_org: Record<string, unknown> | null;
  search_volume: number | null;
};

type Aggregate = {
  clusterName: string;
  generatedCount: number;
  publishedCount: number;
  positionSum: number;
  positionCount: number;
  impressions: number;
  clicks: number;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readMetricFromObjects(objs: Array<Record<string, unknown> | null | undefined>, keys: string[]): number | null {
  for (const obj of objs) {
    if (!obj) continue;
    for (const key of keys) {
      const n = asFiniteNumber(obj[key]);
      if (n !== null) return n;
    }

    // Optional nested gsc payload support.
    const gsc = obj.gsc;
    if (gsc && typeof gsc === 'object') {
      for (const key of keys) {
        const n = asFiniteNumber((gsc as Record<string, unknown>)[key]);
        if (n !== null) return n;
      }
    }
  }

  return null;
}

async function loadQueueRows(limit = 2000): Promise<QueueMetricRow[]> {
  const { data, error } = await supabase
    .from('keyword_queue')
    .select('id,cluster_name,status,metadata,primary_keyword')
    .in('status', ['generated', 'published'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as QueueMetricRow[];
}

async function loadPagesBySlug(slugs: string[]): Promise<Map<string, PageMetricRow>> {
  if (!slugs.length) return new Map();

  const pageMap = new Map<string, PageMetricRow>();
  const chunkSize = 200;

  for (let i = 0; i < slugs.length; i += chunkSize) {
    const chunk = slugs.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('pages')
      .select('slug,status,body_json,schema_org,search_volume')
      .in('slug', chunk);

    if (error) throw error;
    for (const row of (data ?? []) as PageMetricRow[]) {
      pageMap.set(row.slug, row);
    }
  }

  return pageMap;
}

async function run() {
  const queueRows = await loadQueueRows();
  if (!queueRows.length) {
    console.log('[cluster-metrics-rollup] no generated/published keyword queue rows found.');
    return;
  }

  const slugs = queueRows
    .map((row) => {
      const metadata = row.metadata ?? {};
      const slug = metadata.generated_slug;
      if (typeof slug === 'string' && slug.length > 0) return slug;
      return null;
    })
    .filter((v): v is string => Boolean(v));

  const pageBySlug = await loadPagesBySlug(Array.from(new Set(slugs)));
  const byCluster = new Map<string, Aggregate>();

  for (const row of queueRows) {
    const aggregate = byCluster.get(row.cluster_name) ?? {
      clusterName: row.cluster_name,
      generatedCount: 0,
      publishedCount: 0,
      positionSum: 0,
      positionCount: 0,
      impressions: 0,
      clicks: 0,
    };

    aggregate.generatedCount += 1;
    if (row.status === 'published') aggregate.publishedCount += 1;

    const slug = typeof row.metadata?.generated_slug === 'string' ? row.metadata.generated_slug : null;
    const page = slug ? pageBySlug.get(slug) : undefined;

    const metricsSources = [row.metadata ?? null, page?.body_json ?? null, page?.schema_org ?? null];
    const position = readMetricFromObjects(metricsSources, ['position', 'avg_position']);
    const impressions = readMetricFromObjects(metricsSources, ['impressions']) ?? page?.search_volume ?? 0;
    const clicks = readMetricFromObjects(metricsSources, ['clicks']) ?? 0;

    if (position !== null) {
      aggregate.positionSum += position;
      aggregate.positionCount += 1;
    }

    aggregate.impressions += Math.max(0, Math.round(impressions));
    aggregate.clicks += Math.max(0, Math.round(clicks));

    byCluster.set(row.cluster_name, aggregate);
  }

  const upserts = Array.from(byCluster.values()).map((item) => {
    const avgPosition = item.positionCount > 0 ? Number((item.positionSum / item.positionCount).toFixed(2)) : null;
    const ctr = item.impressions > 0 ? Number((item.clicks / item.impressions).toFixed(4)) : 0;

    return {
      cluster_name: item.clusterName,
      generated_count: item.generatedCount,
      published_count: item.publishedCount,
      avg_position: avgPosition,
      impressions: item.impressions,
      clicks: item.clicks,
      ctr,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from('cluster_metrics').upsert(upserts, { onConflict: 'cluster_name' });
  if (error) throw error;

  console.log(`[cluster-metrics-rollup] upserted ${upserts.length} cluster metric row(s).`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
