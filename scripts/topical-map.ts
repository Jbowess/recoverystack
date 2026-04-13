/**
 * Topical Authority Map
 *
 * Computes coverage across clusters × templates for published pages.
 * Upserts into cluster_coverage table.
 * For clusters below 60% completeness, auto-enqueues missing
 * template × cluster combinations into keyword_queue.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildClusterName, normalizeKeyword, pageTemplateToQueueTemplateId } from '@/lib/seo-keywords';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TEMPLATES = [
  'guides',
  'alternatives',
  'protocols',
  'metrics',
  'costs',
  'compatibility',
  'trends',
  'pillars',
] as const;
type Template = (typeof TEMPLATES)[number];

const COMPLETENESS_THRESHOLD = 60;

interface PageRow {
  pillar_id: string | null;
  template: string;
}

interface ClusterRow {
  id: string;
  name: string;
  topic: string;
}

async function run() {
  // Load all published pages with pillar_id + template
  const { data: pages, error: pagesErr } = await supabase
    .from('pages')
    .select('pillar_id, template')
    .eq('status', 'published');

  if (pagesErr) throw pagesErr;

  // Load all keyword clusters
  const { data: clusters, error: clustersErr } = await supabase
    .from('keyword_clusters')
    .select('id, name, topic');

  if (clustersErr) {
    console.warn('[topical-map] keyword_clusters table not found or empty — skipping.');
    return;
  }

  if (!clusters || clusters.length === 0) {
    console.log('[topical-map] No clusters found.');
    return;
  }

  // Build coverage map: clusterId → template → count
  const coverage = new Map<string, Map<Template, number>>();

  for (const cluster of clusters as ClusterRow[]) {
    coverage.set(cluster.id, new Map(TEMPLATES.map((t) => [t, 0])));
  }

  for (const page of (pages ?? []) as PageRow[]) {
    if (!page.pillar_id) continue;
    const templateMap = coverage.get(page.pillar_id);
    if (!templateMap) continue;
    const t = page.template as Template;
    if (TEMPLATES.includes(t)) {
      templateMap.set(t, (templateMap.get(t) ?? 0) + 1);
    }
  }

  let enqueued = 0;

  for (const cluster of clusters as ClusterRow[]) {
    const templateMap = coverage.get(cluster.id) ?? new Map<Template, number>();

    const counts: Record<string, number> = {};
    for (const t of TEMPLATES) {
      counts[t] = templateMap.get(t) ?? 0;
    }

    const totalPublished = Object.values(counts).reduce((a, b) => a + b, 0);
    const coveredTemplates = TEMPLATES.filter((t) => counts[t] > 0).length;
    const completenessPct = parseFloat(((coveredTemplates / TEMPLATES.length) * 100).toFixed(2));
    const missingTemplates = TEMPLATES.filter((t) => counts[t] === 0);

    // Upsert into cluster_coverage
    const { error: upsertErr } = await supabase.from('cluster_coverage').upsert(
      {
        cluster_name: cluster.name,
        guides_count: counts.guides,
        alternatives_count: counts.alternatives,
        protocols_count: counts.protocols,
        metrics_count: counts.metrics,
        costs_count: counts.costs,
        compatibility_count: counts.compatibility,
        trends_count: counts.trends,
        pillars_count: counts.pillars,
        total_published: totalPublished,
        completeness_pct: completenessPct,
        missing_templates: missingTemplates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cluster_name' },
    );

    if (upsertErr) {
      console.warn(`[topical-map] Failed to upsert cluster ${cluster.name}: ${upsertErr.message}`);
      continue;
    }

    // Auto-enqueue missing templates for under-covered clusters
    if (completenessPct < COMPLETENESS_THRESHOLD && missingTemplates.length > 0) {
      for (const template of missingTemplates) {
        const keyword = `${cluster.topic ?? cluster.name} ${template}`;

        const { error: kqErr } = await supabase
          .from('keyword_queue')
          .upsert(
            {
              cluster_name: buildClusterName(cluster.name),
              cluster_id: cluster.id,
              primary_keyword: keyword,
              normalized_keyword: normalizeKeyword(keyword),
              template_id: pageTemplateToQueueTemplateId(template),
              source: 'topical_gap',
              priority: 50,
              score: 0.5,
              status: 'new',
              metadata: { cluster_id: cluster.id, cluster_name: cluster.name, auto_enqueued_by: 'topical-map' },
            },
            { onConflict: 'cluster_name,primary_keyword' },
          );

        if (!kqErr) enqueued++;
      }

      console.log(
        `[topical-map] Cluster "${cluster.name}" at ${completenessPct}% — enqueued ${missingTemplates.length} missing template(s): ${missingTemplates.join(', ')}`,
      );
    }
  }

  console.log(
    `[topical-map] Coverage map updated for ${clusters.length} cluster(s). Auto-enqueued ${enqueued} keyword(s).`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
