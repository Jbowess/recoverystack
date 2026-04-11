import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

type PageMetricTarget = {
  id: string;
  slug: string;
  primary_keyword: string | null;
  search_volume: number | null;
};

type GscSlugMetric = {
  slug: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  searchVolumePlaceholder: number;
};

const DEFAULT_PLACEHOLDER_SEARCH_VOLUME = Number(process.env.GSC_PLACEHOLDER_SEARCH_VOLUME ?? 0);

async function loadMetricTargets(limit = 200): Promise<PageMetricTarget[]> {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,primary_keyword,search_volume')
    .in('status', ['published', 'draft'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as PageMetricTarget[];
}

/**
 * GSC integration scaffold.
 *
 * Replace this stub with real Search Console API calls (query by page path and date range):
 * https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */
async function fetchSlugMetricsFromGsc(slugs: string[]): Promise<GscSlugMetric[]> {
  console.log(`GSC stub active. No live API call yet; generating placeholder metrics for ${slugs.length} slug(s).`);

  return slugs.map((slug) => ({
    slug,
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
    searchVolumePlaceholder: DEFAULT_PLACEHOLDER_SEARCH_VOLUME,
  }));
}

async function writeSearchVolumePlaceholders(targets: PageMetricTarget[], metrics: GscSlugMetric[]) {
  const metricsBySlug = new Map(metrics.map((m) => [m.slug, m]));

  let updated = 0;
  for (const target of targets) {
    const metric = metricsBySlug.get(target.slug);
    if (!metric) continue;

    // Placeholder write policy: only backfill empty search_volume values.
    if (target.search_volume !== null) continue;

    const { error } = await supabase
      .from('pages')
      .update({ search_volume: metric.searchVolumePlaceholder })
      .eq('id', target.id);

    if (error) {
      console.error(`Failed to update search_volume for ${target.slug}:`, error);
      continue;
    }

    updated += 1;
  }

  return updated;
}

async function run() {
  const targets = await loadMetricTargets();
  if (!targets.length) {
    console.log('No pages found for GSC sync.');
    return;
  }

  const slugs = targets.map((row) => row.slug);
  const metrics = await fetchSlugMetricsFromGsc(slugs);
  const updated = await writeSearchVolumePlaceholders(targets, metrics);

  console.log(`GSC sync scaffold complete. Processed ${targets.length} page(s), backfilled ${updated} placeholder search_volume value(s).`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
