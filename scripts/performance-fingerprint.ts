/**
 * Performance Fingerprint
 *
 * Analyses top-performing published pages (ranked by GSC clicks, impressions,
 * or quality score) to extract structural and content characteristics that
 * correlate with ranking success. These "winning patterns" are stored in
 * `performance_fingerprints` and surfaced in briefs as `structural_guidance`
 * so content generation mimics what already works in this domain.
 *
 * Extracts per cluster:
 *   - Median word count of top performers
 *   - Most common H2 patterns (question vs statement vs how-to vs list)
 *   - FAQ usage rate
 *   - Table usage rate
 *   - Internal link count range
 *   - Schema types present
 *   - Image count median
 *   - Recommended content format
 *
 * Updates briefs.structural_guidance with the cluster-level fingerprint.
 *
 * Usage:
 *   npx tsx scripts/performance-fingerprint.ts
 *   FINGERPRINT_TOP_N=20 npx tsx scripts/performance-fingerprint.ts
 *   npx tsx scripts/performance-fingerprint.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TOP_N = Number(process.env.FINGERPRINT_TOP_N ?? 15);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const REFRESH_AFTER_DAYS = Number(process.env.FINGERPRINT_REFRESH_DAYS ?? 7);

type PageMetrics = {
  slug: string;
  cluster_slug: string | null;
  template: string;
  quality_score: number | null;
  word_count: number | null;
  h2_count: number | null;
  faq_count: number | null;
  table_count: number | null;
  image_count: number | null;
  internal_link_count: number | null;
  schema_types: string[];
  body_json: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  avg_position: number | null;
  total_clicks: number | null;
  total_impressions: number | null;
};

type FingerprintRow = {
  cluster_slug: string;
  template: string;
  sample_size: number;
  median_word_count: number | null;
  p25_word_count: number | null;
  p75_word_count: number | null;
  median_h2_count: number | null;
  faq_usage_rate: number;
  table_usage_rate: number;
  median_image_count: number | null;
  median_internal_links: number | null;
  common_schema_types: string[];
  h2_patterns: Record<string, number>;
  recommended_word_count_min: number | null;
  recommended_word_count_max: number | null;
  avg_quality_score: number | null;
  avg_position: number | null;
  computed_at: string;
};

// ── Statistical helpers ───────────────────────────────────────────────────────
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

// ── H2 pattern classification ─────────────────────────────────────────────────
function classifyH2Patterns(pages: PageMetrics[]): Record<string, number> {
  const patterns: Record<string, number> = {
    question: 0,
    how_to: 0,
    list_style: 0,
    comparison: 0,
    definition: 0,
    statement: 0,
  };

  for (const page of pages) {
    const bodyJson = page.body_json ?? {};
    const sections = (bodyJson.sections ?? []) as Array<{ heading?: string }>;

    for (const section of sections) {
      const h = (section.heading ?? '').toLowerCase().trim();
      if (!h) continue;
      if (/^(what|how|why|when|which|can|should|does|is|are|do)\b/.test(h)) {
        patterns.question++;
      } else if (/^how to\b/.test(h) || /\bsteps?\b/.test(h)) {
        patterns.how_to++;
      } else if (/^(best|top|key|main|common|major)\b/.test(h) || /\d+\s+(ways|tips|things|reasons)/.test(h)) {
        patterns.list_style++;
      } else if (/\bvs\.?\b|\bversus\b|\bcompared?\b|\bor\b/.test(h)) {
        patterns.comparison++;
      } else if (/^(what is|definition|overview|introduction)\b/.test(h) || h.endsWith('?') === false && h.includes(':')) {
        patterns.definition++;
      } else {
        patterns.statement++;
      }
    }
  }

  // Normalise to rates
  const total = Object.values(patterns).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const key of Object.keys(patterns)) {
      patterns[key] = Math.round((patterns[key] / total) * 100);
    }
  }

  return patterns;
}

// ── Schema type aggregation ───────────────────────────────────────────────────
function aggregateSchemaTypes(pages: PageMetrics[]): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const t of page.schema_types) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  // Only include types present in ≥40% of pages
  const threshold = pages.length * 0.4;
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
}

// ── Compute fingerprint for a group of pages ──────────────────────────────────
function computeFingerprint(
  clusterSlug: string,
  template: string,
  pages: PageMetrics[],
): FingerprintRow {
  const wordCounts = pages.map((p) => p.word_count ?? 0).filter((n) => n > 0);
  const h2Counts = pages.map((p) => p.h2_count ?? 0).filter((n) => n > 0);
  const imageCounts = pages.map((p) => p.image_count ?? 0);
  const linkCounts = pages.map((p) => p.internal_link_count ?? 0);
  const qualityScores = pages.map((p) => p.quality_score ?? 0).filter((n) => n > 0);
  const positions = pages.map((p) => p.avg_position ?? 0).filter((n) => n > 0);

  const faqUsageRate = pages.filter((p) => (p.faq_count ?? 0) > 0).length / pages.length;
  const tableUsageRate = pages.filter((p) => (p.table_count ?? 0) > 0).length / pages.length;

  const medianWordCount = median(wordCounts);
  const p25WordCount = percentile(wordCounts, 25);
  const p75WordCount = percentile(wordCounts, 75);

  return {
    cluster_slug: clusterSlug,
    template,
    sample_size: pages.length,
    median_word_count: medianWordCount,
    p25_word_count: p25WordCount,
    p75_word_count: p75WordCount,
    median_h2_count: median(h2Counts),
    faq_usage_rate: Math.round(faqUsageRate * 100) / 100,
    table_usage_rate: Math.round(tableUsageRate * 100) / 100,
    median_image_count: median(imageCounts),
    median_internal_links: median(linkCounts),
    common_schema_types: aggregateSchemaTypes(pages),
    h2_patterns: classifyH2Patterns(pages),
    recommended_word_count_min: p25WordCount,
    recommended_word_count_max: p75WordCount,
    avg_quality_score: qualityScores.length > 0
      ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
      : null,
    avg_position: positions.length > 0
      ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
      : null,
    computed_at: new Date().toISOString(),
  };
}

// ── Update briefs for a cluster with structural guidance ──────────────────────
async function enrichBriefs(fingerprint: FingerprintRow): Promise<void> {
  if (DRY_RUN) return;

  const { data: pages } = await supabase
    .from('pages')
    .select('slug')
    .eq('cluster_slug', fingerprint.cluster_slug)
    .in('status', ['draft', 'queued']);

  for (const page of (pages ?? []) as Array<{ slug: string }>) {
    await supabase
      .from('briefs')
      .update({
        structural_guidance: {
          recommended_word_count_min: fingerprint.recommended_word_count_min,
          recommended_word_count_max: fingerprint.recommended_word_count_max,
          faq_usage_rate: fingerprint.faq_usage_rate,
          table_usage_rate: fingerprint.table_usage_rate,
          median_h2_count: fingerprint.median_h2_count,
          h2_patterns: fingerprint.h2_patterns,
          common_schema_types: fingerprint.common_schema_types,
          median_internal_links: fingerprint.median_internal_links,
          sample_size: fingerprint.sample_size,
          avg_position: fingerprint.avg_position,
        },
      })
      .eq('page_slug', page.slug);
  }
}

async function run(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  // Check which clusters were recently fingerprinted
  const { data: recentData } = await supabase
    .from('performance_fingerprints')
    .select('cluster_slug')
    .gte('computed_at', cutoff);
  const recentClusters = new Set((recentData ?? []).map((r: any) => String(r.cluster_slug)));

  // Load published pages with performance metrics
  const { data: pagesData, error: pagesError } = await supabase
    .from('pages')
    .select(`
      slug,
      cluster_slug,
      template,
      quality_score,
      word_count,
      metadata,
      body_json
    `)
    .eq('status', 'published')
    .not('cluster_slug', 'is', null)
    .order('quality_score', { ascending: false })
    .limit(500);

  if (pagesError) throw pagesError;

  // Join page_metrics for GSC data
  const slugs = (pagesData ?? []).map((p: any) => p.slug);
  const { data: metricsData } = await supabase
    .from('page_metrics')
    .select('slug, avg_position, total_clicks, total_impressions')
    .in('slug', slugs);

  const metricsMap = new Map(
    ((metricsData ?? []) as Array<{ slug: string; avg_position: number; total_clicks: number; total_impressions: number }>)
      .map((m) => [m.slug, m]),
  );

  // Build full page objects
  const pages: PageMetrics[] = (pagesData ?? []).map((p: any) => {
    const metrics = metricsMap.get(p.slug);
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    return {
      slug: p.slug,
      cluster_slug: p.cluster_slug ?? null,
      template: p.template ?? 'guide',
      quality_score: p.quality_score ?? null,
      word_count: typeof meta.word_count === 'number' ? meta.word_count : null,
      h2_count: typeof meta.h2_count === 'number' ? meta.h2_count : null,
      faq_count: typeof meta.faq_count === 'number' ? meta.faq_count : null,
      table_count: typeof meta.table_count === 'number' ? meta.table_count : null,
      image_count: typeof meta.image_count === 'number' ? meta.image_count : null,
      internal_link_count: typeof meta.internal_link_count === 'number' ? meta.internal_link_count : null,
      schema_types: Array.isArray(meta.schema_types) ? meta.schema_types as string[] : [],
      body_json: (p.body_json ?? null) as Record<string, unknown> | null,
      metadata: meta,
      avg_position: metrics?.avg_position ?? null,
      total_clicks: metrics?.total_clicks ?? null,
      total_impressions: metrics?.total_impressions ?? null,
    };
  });

  // Group by cluster + template
  const groups = new Map<string, PageMetrics[]>();
  for (const page of pages) {
    if (!page.cluster_slug) continue;
    const key = `${page.cluster_slug}::${page.template}`;
    const arr = groups.get(key) ?? [];
    arr.push(page);
    groups.set(key, arr);
  }

  let processed = 0;
  for (const [key, groupPages] of groups) {
    const [clusterSlug, template] = key.split('::');

    if (recentClusters.has(clusterSlug)) {
      console.log(`[fingerprint] ${clusterSlug}: recently computed, skipping`);
      continue;
    }

    if (groupPages.length < 2) continue; // need at least 2 to fingerprint

    // Score pages: prioritise by clicks > quality > position
    const scored = groupPages.map((p) => ({
      ...p,
      score: (p.total_clicks ?? 0) * 10 + (p.quality_score ?? 0) + (100 - (p.avg_position ?? 100)),
    })).sort((a, b) => b.score - a.score);

    const topPages = scored.slice(0, TOP_N);
    const fingerprint = computeFingerprint(clusterSlug, template, topPages);

    console.log(
      `[fingerprint] ${clusterSlug}/${template}: n=${topPages.length} ` +
      `words=${fingerprint.recommended_word_count_min}-${fingerprint.recommended_word_count_max} ` +
      `faq=${Math.round(fingerprint.faq_usage_rate * 100)}% ` +
      `pos=${fingerprint.avg_position ?? 'N/A'}`,
    );

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('performance_fingerprints')
        .upsert(fingerprint, { onConflict: 'cluster_slug,template' });

      if (error) {
        console.warn(`[fingerprint] DB write failed for ${clusterSlug}: ${error.message}`);
        continue;
      }

      await enrichBriefs(fingerprint);
    }

    processed++;
  }

  console.log(`[fingerprint] Done. Processed ${processed} cluster/template groups (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
