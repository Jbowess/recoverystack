/**
 * Cluster Completeness Checker
 *
 * Systematically audits each topical cluster to detect missing subtopics,
 * supporting content types, and keyword variations that competitors cover
 * but we don't. Writes gaps to `cluster_completeness` and enqueues
 * high-value missing keywords to `keyword_queue`.
 *
 * Gap detection methods:
 *   1. Pillar coverage — every cluster should have exactly one pillar page
 *   2. Template coverage — each cluster should have guide, alternatives,
 *      comparison, metrics, and protocol pages where applicable
 *   3. PAA gap — PAA questions from serp_features not answered by any page
 *   4. Keyword variation gaps — keyword_queue entries with no matching page
 *   5. Competitor-derived gaps — entities from competitor_page_analyses
 *      not covered by any page in the cluster
 *
 * Usage:
 *   npx tsx scripts/cluster-completeness-checker.ts
 *   npx tsx scripts/cluster-completeness-checker.ts --dry-run
 *   CLUSTER_LIMIT=20 npx tsx scripts/cluster-completeness-checker.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const CLUSTER_LIMIT = Number(process.env.CLUSTER_LIMIT ?? 50);
const REFRESH_AFTER_DAYS = Number(process.env.COMPLETENESS_REFRESH_DAYS ?? 3);

// Templates that indicate solid cluster coverage
const COVERAGE_TEMPLATES = ['guide', 'alternatives', 'comparison', 'metrics', 'protocol', 'cost', 'review'] as const;

type CoverageTemplate = (typeof COVERAGE_TEMPLATES)[number];

type ClusterData = {
  slug: string;
  label: string;
  pillar_keyword: string | null;
  target_templates: string[];
};

type PageInCluster = {
  slug: string;
  template: string;
  primary_keyword: string;
  status: string;
  quality_score: number | null;
};

type GapItem = {
  gap_type: 'missing_template' | 'paa_unanswered' | 'keyword_variation' | 'competitor_entity' | 'missing_pillar';
  description: string;
  suggested_keyword: string;
  suggested_template: string;
  priority_score: number;
  source: string;
};

type CompletenessRow = {
  cluster_slug: string;
  cluster_label: string;
  completeness_score: number;
  pages_published: number;
  pages_draft: number;
  pages_queued: number;
  has_pillar: boolean;
  covered_templates: string[];
  missing_templates: string[];
  paa_gap_count: number;
  competitor_entity_gap_count: number;
  keyword_variation_gap_count: number;
  gaps: GapItem[];
  enqueued_keywords: string[];
  checked_at: string;
};

// ── Template suggestions per cluster type ─────────────────────────────────────
const TEMPLATE_KEYWORD_SUFFIX: Record<CoverageTemplate, (pillarKw: string) => string> = {
  guide: (kw) => `${kw} guide`,
  alternatives: (kw) => `${kw} alternatives`,
  comparison: (kw) => `${kw} comparison`,
  metrics: (kw) => `${kw} metrics`,
  protocol: (kw) => `${kw} protocol`,
  cost: (kw) => `${kw} cost`,
  review: (kw) => `${kw} review`,
};

// ── Compute completeness score 0-100 ─────────────────────────────────────────
function computeCompletenessScore(
  hasPillar: boolean,
  coveredTemplates: string[],
  targetTemplates: string[],
  paaGapCount: number,
  competitorGapCount: number,
): number {
  let score = 0;

  // Pillar presence: 20 points
  if (hasPillar) score += 20;

  // Template coverage: up to 40 points
  const templateCoverage = targetTemplates.length > 0
    ? coveredTemplates.length / targetTemplates.length
    : 1;
  score += Math.round(templateCoverage * 40);

  // PAA gap penalty: -2 per unanswered question (max -20)
  score -= Math.min(20, paaGapCount * 2);

  // Competitor entity gap penalty: -1 per entity (max -10)
  score -= Math.min(10, competitorGapCount);

  return Math.max(0, Math.min(100, score));
}

// ── Detect PAA gaps ───────────────────────────────────────────────────────────
async function detectPaaGaps(cluster: ClusterData, clusterPages: PageInCluster[]): Promise<GapItem[]> {
  const { data: serpData } = await supabase
    .from('serp_features')
    .select('keyword, paa_questions')
    .in('keyword', clusterPages.map((p) => p.primary_keyword));

  const gaps: GapItem[] = [];
  const clusterKeywordsLower = clusterPages.map((p) => p.primary_keyword.toLowerCase());

  for (const row of (serpData ?? []) as Array<{ keyword: string; paa_questions: Array<{ question: string }> }>) {
    for (const paa of (row.paa_questions ?? [])) {
      const q = paa.question.toLowerCase();
      // Check if any page already targets this question
      const isCovered = clusterKeywordsLower.some(
        (kw) => q.includes(kw) || kw.includes(q.split(' ').slice(0, 3).join(' ')),
      );
      if (!isCovered) {
        gaps.push({
          gap_type: 'paa_unanswered',
          description: `PAA question not targeted: "${paa.question}"`,
          suggested_keyword: paa.question.toLowerCase().replace(/[?!]/g, '').trim(),
          suggested_template: 'guide',
          priority_score: 60,
          source: `serp_features:${row.keyword}`,
        });
      }
    }
  }

  return gaps.slice(0, 10);
}

// ── Detect competitor entity gaps ─────────────────────────────────────────────
async function detectCompetitorEntityGaps(cluster: ClusterData, clusterPages: PageInCluster[]): Promise<GapItem[]> {
  const { data: compData } = await supabase
    .from('competitor_page_analyses')
    .select('keyword, required_entities, differentiating_entities')
    .in('keyword', clusterPages.map((p) => p.primary_keyword))
    .limit(20);

  if (!compData || compData.length === 0) return [];

  const clusterText = clusterPages.map((p) => p.primary_keyword.toLowerCase()).join(' ');
  const gaps: GapItem[] = [];

  for (const row of compData as Array<{ keyword: string; required_entities: string[]; differentiating_entities: string[] }>) {
    const entities = [...(row.required_entities ?? []), ...(row.differentiating_entities ?? [])];
    for (const entity of entities) {
      const entityLower = entity.toLowerCase();
      if (!clusterText.includes(entityLower) && entityLower.split(' ').length <= 4) {
        gaps.push({
          gap_type: 'competitor_entity',
          description: `Competitor covers entity not in cluster: "${entity}"`,
          suggested_keyword: `${cluster.pillar_keyword ?? cluster.slug} ${entityLower}`,
          suggested_template: 'guide',
          priority_score: 55,
          source: `competitor_page_analyses:${row.keyword}`,
        });
      }
    }
  }

  // Deduplicate by suggested_keyword
  const seen = new Set<string>();
  return gaps.filter((g) => {
    if (seen.has(g.suggested_keyword)) return false;
    seen.add(g.suggested_keyword);
    return true;
  }).slice(0, 8);
}

// ── Detect keyword variation gaps ─────────────────────────────────────────────
async function detectKeywordVariationGaps(cluster: ClusterData, clusterPages: PageInCluster[]): Promise<GapItem[]> {
  const { data: queueData } = await supabase
    .from('keyword_queue')
    .select('keyword, search_volume, difficulty')
    .ilike('keyword', `%${cluster.pillar_keyword ?? cluster.slug}%`)
    .in('status', ['new', 'in_progress'])
    .order('search_volume', { ascending: false })
    .limit(20);

  if (!queueData || queueData.length === 0) return [];

  const existingKeywords = new Set(clusterPages.map((p) => p.primary_keyword.toLowerCase()));
  const gaps: GapItem[] = [];

  for (const q of queueData as Array<{ keyword: string; search_volume?: number; difficulty?: number }>) {
    if (!existingKeywords.has(q.keyword.toLowerCase())) {
      const vol = q.search_volume ?? 0;
      gaps.push({
        gap_type: 'keyword_variation',
        description: `Keyword in queue but no page: "${q.keyword}" (vol=${vol})`,
        suggested_keyword: q.keyword,
        suggested_template: 'guide',
        priority_score: Math.min(90, 40 + Math.round(vol / 100)),
        source: 'keyword_queue',
      });
    }
  }

  return gaps.slice(0, 5);
}

// ── Enqueue high-priority gaps to keyword_queue ───────────────────────────────
async function enqueueGaps(cluster: ClusterData, gaps: GapItem[]): Promise<string[]> {
  const highPriority = gaps
    .filter((g) => g.priority_score >= 60)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5);

  const enqueued: string[] = [];

  for (const gap of highPriority) {
    if (DRY_RUN) {
      enqueued.push(gap.suggested_keyword);
      continue;
    }

    const { error } = await supabase
      .from('keyword_queue')
      .upsert(
        {
          keyword: gap.suggested_keyword,
          normalized_keyword: gap.suggested_keyword.toLowerCase().replace(/\s+/g, '-'),
          status: 'new',
          source: 'cluster_completeness',
          cluster_slug: cluster.slug,
          suggested_template: gap.suggested_template,
          metadata: {
            gap_type: gap.gap_type,
            gap_description: gap.description,
            gap_source: gap.source,
            priority_score: gap.priority_score,
          },
        },
        { onConflict: 'keyword' },
      );

    if (!error) enqueued.push(gap.suggested_keyword);
  }

  return enqueued;
}

async function analyzeCluster(cluster: ClusterData): Promise<CompletenessRow> {
  // Load all pages in the cluster
  const { data: pagesData } = await supabase
    .from('pages')
    .select('slug, template, primary_keyword, status, quality_score')
    .eq('cluster_slug', cluster.slug);

  const clusterPages = (pagesData ?? []) as PageInCluster[];
  const publishedPages = clusterPages.filter((p) => p.status === 'published');
  const draftPages = clusterPages.filter((p) => p.status === 'draft');
  const queuedPages = clusterPages.filter((p) => p.status === 'queued');

  const hasPillar = clusterPages.some((p) => p.template === 'pillar');
  const coveredTemplates = [...new Set(publishedPages.map((p) => p.template))];

  // Template gap detection
  const targetTemplates = cluster.target_templates.length > 0
    ? cluster.target_templates
    : COVERAGE_TEMPLATES.slice(0, 4) as unknown as string[];

  const missingTemplates = targetTemplates.filter((t) => !coveredTemplates.includes(t));
  const templateGaps: GapItem[] = missingTemplates.map((t) => ({
    gap_type: 'missing_template' as const,
    description: `Missing ${t} page for cluster "${cluster.label}"`,
    suggested_keyword: TEMPLATE_KEYWORD_SUFFIX[t as CoverageTemplate]
      ? TEMPLATE_KEYWORD_SUFFIX[t as CoverageTemplate](cluster.pillar_keyword ?? cluster.slug)
      : `${cluster.pillar_keyword ?? cluster.slug} ${t}`,
    suggested_template: t,
    priority_score: t === 'guide' ? 80 : t === 'alternatives' ? 70 : 60,
    source: 'template_coverage',
  }));

  const pillarGaps: GapItem[] = !hasPillar ? [{
    gap_type: 'missing_pillar',
    description: `Cluster "${cluster.label}" has no pillar page`,
    suggested_keyword: cluster.pillar_keyword ?? cluster.label.toLowerCase(),
    suggested_template: 'pillar',
    priority_score: 90,
    source: 'pillar_check',
  }] : [];

  // Parallel gap detection
  const [paaGaps, competitorGaps, variationGaps] = await Promise.all([
    detectPaaGaps(cluster, publishedPages.length > 0 ? publishedPages : clusterPages),
    detectCompetitorEntityGaps(cluster, publishedPages.length > 0 ? publishedPages : clusterPages),
    detectKeywordVariationGaps(cluster, clusterPages),
  ]);

  const allGaps = [...pillarGaps, ...templateGaps, ...paaGaps, ...competitorGaps, ...variationGaps]
    .sort((a, b) => b.priority_score - a.priority_score);

  const completenessScore = computeCompletenessScore(
    hasPillar,
    coveredTemplates,
    targetTemplates,
    paaGaps.length,
    competitorGaps.length,
  );

  const enqueued = await enqueueGaps(cluster, allGaps);

  return {
    cluster_slug: cluster.slug,
    cluster_label: cluster.label,
    completeness_score: completenessScore,
    pages_published: publishedPages.length,
    pages_draft: draftPages.length,
    pages_queued: queuedPages.length,
    has_pillar: hasPillar,
    covered_templates: coveredTemplates,
    missing_templates: missingTemplates,
    paa_gap_count: paaGaps.length,
    competitor_entity_gap_count: competitorGaps.length,
    keyword_variation_gap_count: variationGaps.length,
    gaps: allGaps.slice(0, 20),
    enqueued_keywords: enqueued,
    checked_at: new Date().toISOString(),
  };
}

async function run(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  const { data: recentData } = await supabase
    .from('cluster_completeness')
    .select('cluster_slug')
    .gte('checked_at', cutoff);
  const recentClusters = new Set((recentData ?? []).map((r: any) => String(r.cluster_slug)));

  const { data: clustersData, error } = await supabase
    .from('keyword_clusters')
    .select('slug, label, pillar_keyword, target_templates')
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(CLUSTER_LIMIT);

  if (error) throw error;

  const clusters = ((clustersData ?? []) as Array<{
    slug: string;
    label: string;
    pillar_keyword?: string;
    target_templates?: string[];
  }>).map((c) => ({
    slug: c.slug,
    label: c.label,
    pillar_keyword: c.pillar_keyword ?? null,
    target_templates: c.target_templates ?? [],
  }));

  let processed = 0;
  let totalEnqueued = 0;

  for (const cluster of clusters) {
    if (recentClusters.has(cluster.slug)) {
      console.log(`[cluster-completeness] ${cluster.slug}: recently checked, skipping`);
      continue;
    }

    const result = await analyzeCluster(cluster);
    totalEnqueued += result.enqueued_keywords.length;

    console.log(
      `[cluster-completeness] ${cluster.slug}: score=${result.completeness_score} ` +
      `published=${result.pages_published} gaps=${result.gaps.length} ` +
      `enqueued=${result.enqueued_keywords.length}`,
    );

    if (!DRY_RUN) {
      const { error: upsertError } = await supabase
        .from('cluster_completeness')
        .upsert(result, { onConflict: 'cluster_slug' });

      if (upsertError) {
        console.warn(`[cluster-completeness] DB write failed for ${cluster.slug}: ${upsertError.message}`);
      }
    }

    processed++;
  }

  console.log(`[cluster-completeness] Done. Checked ${processed} clusters, enqueued ${totalEnqueued} keywords (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
