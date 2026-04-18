/**
 * Content Brief Generator
 *
 * Runs between gap-analyzer and content-generator in the pipeline.
 * For each content_gaps row created in the last 24 hours:
 *   1. Competitor word counts from SERP snapshot URLs
 *   2. Target word count = max(competitors) × 1.2 (or fingerprint range if available)
 *   3. Required subtopics from heading_gaps + competitor TF-IDF entities
 *   4. Required PAA answers from serp_features + snapshot
 *   5. Community questions from community_qa table
 *   6. SERP feature context (snippet type, recommended format)
 *   7. Performance fingerprint structural guidance
 *   8. Search volume + difficulty from keyword_volume_data / keyword_queue
 *   9. Product specs for product-focused pages
 *  10. Clinical trials and upcoming research
 *  11. Product sentiment from app reviews
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Strip HTML tags and return approximate word count */
function htmlWordCount(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.split(' ').filter(Boolean).length;
}

async function fetchCompetitorWordCount(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecoveryStackBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return htmlWordCount(html);
  } catch {
    return null;
  }
}

interface SerpTopResult {
  link?: string;
  title?: string;
}

interface PaaItem {
  question: string;
  snippet?: string;
}

interface SerpSnapshot {
  heading_gaps?: string[];
  top_results?: SerpTopResult[];
  people_also_ask?: PaaItem[];
}

interface ContentGapRow {
  id: string;
  page_slug: string;
  keyword: string;
  cluster_slug?: string | null;
  serp_snapshot?: SerpSnapshot;
  serp_features?: Record<string, unknown> | null;
}

interface KeywordQueueRow {
  real_search_volume?: number | null;
  keyword_difficulty?: number | null;
  metadata?: Record<string, unknown> | null;
}

// ── Load enrichment data in parallel for a given slug+keyword ────────────────
async function loadEnrichmentData(pageSlug: string, keyword: string, clusterSlug: string | null) {
  const [
    serpFeaturesResult,
    competitorAnalysisResult,
    communityQaResult,
    keywordVolumeResult,
    fingerprintResult,
    productSpecResult,
    clinicalTrialsResult,
    appReviewResult,
  ] = await Promise.all([
    // SERP features
    supabase
      .from('serp_features')
      .select('recommended_format,has_featured_snippet,featured_snippet_type,featured_snippet_text,paa_questions,paa_count,has_video_carousel,has_news_results,avg_serp_word_count')
      .eq('keyword', keyword)
      .limit(1)
      .single(),

    // Competitor TF-IDF entities
    supabase
      .from('competitor_page_analyses')
      .select('required_entities,differentiating_entities,h2_headings,faq_count,avg_word_count,schema_types')
      .eq('keyword', keyword)
      .order('position', { ascending: true })
      .limit(5),

    // Community Q&A
    supabase
      .from('community_qa')
      .select('question,answer_snippet,source_platform,vote_score,sentiment')
      .or(`page_slug.eq.${pageSlug},keyword.ilike.%${keyword.split(' ').slice(0, 3).join(' ')}%`)
      .order('vote_score', { ascending: false })
      .limit(10),

    // Authoritative keyword volume
    supabase
      .from('keyword_volume_data')
      .select('search_volume,keyword_difficulty,cpc_usd,search_intent,parent_keyword')
      .eq('keyword', keyword)
      .limit(1)
      .single(),

    // Performance fingerprint for the cluster
    clusterSlug
      ? supabase
          .from('performance_fingerprints')
          .select('recommended_word_count_min,recommended_word_count_max,faq_usage_rate,table_usage_rate,median_h2_count,h2_patterns,common_schema_types,median_internal_links,avg_position')
          .eq('cluster_slug', clusterSlug)
          .limit(1)
          .single()
      : Promise.resolve({ data: null }),

    // Product specs
    supabase
      .from('product_specs')
      .select('slug,brand,model,price_usd,battery_life_hours,weight_grams,sensors,health_metrics,subscription_required,subscription_price_usd_month')
      .or(`page_slug.eq.${pageSlug},slug.ilike.%${keyword.split(' ').slice(0, 2).join('-')}%`)
      .limit(3),

    // Clinical trials
    supabase
      .from('clinical_trials')
      .select('nct_id,title,status,phase,sponsor_name,significance_score,primary_outcomes,completion_date')
      .contains('page_slugs', [pageSlug])
      .order('significance_score', { ascending: false })
      .limit(5),

    // App review aggregates
    supabase
      .from('app_review_aggregates')
      .select('app_slug,avg_rating,positive_pct,top_pain_points,top_praised_features,top_themes')
      .or(`app_slug.ilike.%${keyword.split(' ')[0]}%`)
      .limit(3),
  ]);

  return {
    serpFeatures: serpFeaturesResult.data,
    competitorAnalyses: (competitorAnalysisResult.data ?? []) as Array<{
      required_entities: string[];
      differentiating_entities: string[];
      h2_headings: string[];
      faq_count: number;
      avg_word_count: number;
      schema_types: string[];
    }>,
    communityQa: (communityQaResult.data ?? []) as Array<{
      question: string;
      answer_snippet: string | null;
      source_platform: string;
      vote_score: number;
      sentiment: string;
    }>,
    keywordVolume: keywordVolumeResult.data as {
      search_volume: number;
      keyword_difficulty: number;
      cpc_usd: number;
      search_intent: string;
      parent_keyword: string;
    } | null,
    fingerprint: fingerprintResult.data,
    productSpecs: (productSpecResult.data ?? []),
    clinicalTrials: (clinicalTrialsResult.data ?? []),
    appReviews: (appReviewResult.data ?? []),
  };
}

async function generateBrief(gap: ContentGapRow): Promise<void> {
  const snapshot: SerpSnapshot = gap.serp_snapshot ?? {};
  const topResults: SerpTopResult[] = snapshot.top_results ?? [];
  const paaItems: PaaItem[] = snapshot.people_also_ask ?? [];
  const headingGaps: string[] = snapshot.heading_gaps ?? [];

  // ── Load all enrichment data in parallel ────────────────────────────────────
  const enrichment = await loadEnrichmentData(gap.page_slug, gap.keyword, gap.cluster_slug ?? null);

  // ── Competitor word counts ──────────────────────────────────────────────────
  const competitorUrls = topResults
    .slice(0, 3)
    .map((r) => r.link)
    .filter((u): u is string => Boolean(u));

  const wordCountEntries = await Promise.all(
    competitorUrls.map(async (url) => {
      const count = await fetchCompetitorWordCount(url);
      return [url, count] as [string, number | null];
    }),
  );

  const competitorWordCounts: Record<string, number> = {};
  const validCounts: number[] = [];
  for (const [url, count] of wordCountEntries) {
    if (count !== null) {
      competitorWordCounts[url] = count;
      validCounts.push(count);
    }
  }

  // Also use competitor_page_analyses avg_word_count if direct fetch failed
  if (validCounts.length === 0) {
    for (const analysis of enrichment.competitorAnalyses) {
      if (analysis.avg_word_count > 0) validCounts.push(analysis.avg_word_count);
    }
  }

  // ── Target word count: max(competitors) × 1.2, bounded by fingerprint ──────
  let targetWordCount: number;
  const maxWordCount = validCounts.length > 0 ? Math.max(...validCounts) : 1200;
  const rawTarget = Math.round(maxWordCount * 1.2);

  if (enrichment.fingerprint) {
    const fp = enrichment.fingerprint as { recommended_word_count_min?: number; recommended_word_count_max?: number };
    const fpMin = fp.recommended_word_count_min ?? 0;
    const fpMax = fp.recommended_word_count_max ?? Infinity;
    // Use fingerprint range as soft bounds — apply only if raw target is outside 150% of range
    if (rawTarget < fpMin * 0.7) targetWordCount = fpMin;
    else if (rawTarget > fpMax * 1.5) targetWordCount = fpMax;
    else targetWordCount = rawTarget;
  } else {
    targetWordCount = rawTarget;
  }

  // ── Required entities from TF-IDF competitor analysis ─────────────────────
  const requiredEntities: string[] = [
    ...new Set(enrichment.competitorAnalyses.flatMap((a) => a.required_entities ?? [])),
  ].slice(0, 15);

  const differentiatingEntities: string[] = [
    ...new Set(enrichment.competitorAnalyses.flatMap((a) => a.differentiating_entities ?? [])),
  ].slice(0, 10);

  // ── Required subtopics from heading gaps + competitor H2s ─────────────────
  const competitorH2s = [
    ...new Set(enrichment.competitorAnalyses.flatMap((a) => a.h2_headings ?? [])),
  ].slice(0, 8);
  const requiredSubtopics = [...new Set([...headingGaps, ...competitorH2s])].slice(0, 12);

  // ── PAA answers: merge snapshot + serp_features PAA questions ─────────────
  const serpPaaQuestions = Array.isArray(enrichment.serpFeatures?.paa_questions)
    ? (enrichment.serpFeatures.paa_questions as Array<{ question: string }>).map((q) => q.question)
    : [];
  const snapshotPaaQuestions = paaItems.map((p) => p.question);
  const requiredPaaAnswers = [...new Set([...snapshotPaaQuestions, ...serpPaaQuestions])].slice(0, 10);

  // ── Competitor weaknesses ──────────────────────────────────────────────────
  const competitorWeaknesses = paaItems
    .filter((p) => !p.snippet)
    .map((p) => p.question)
    .slice(0, 5);

  // ── Community questions (from Reddit, YouTube, forums) ────────────────────
  const communityQuestions = enrichment.communityQa
    .filter((q) => q.question)
    .map((q) => ({
      question: q.question,
      platform: q.source_platform,
      votes: q.vote_score,
      snippet: q.answer_snippet,
    }))
    .slice(0, 8);

  // ── Positive sentiment phrases for brand mentions ─────────────────────────
  const positiveSentimentPhrases = enrichment.communityQa
    .filter((q) => q.sentiment === 'positive' && q.answer_snippet)
    .map((q) => q.answer_snippet!)
    .slice(0, 5);

  // ── SERP feature context ───────────────────────────────────────────────────
  const serpFeatureContext = enrichment.serpFeatures
    ? {
        recommended_format: enrichment.serpFeatures.recommended_format,
        has_featured_snippet: enrichment.serpFeatures.has_featured_snippet,
        featured_snippet_type: enrichment.serpFeatures.featured_snippet_type,
        featured_snippet_text: enrichment.serpFeatures.featured_snippet_text,
        paa_count: enrichment.serpFeatures.paa_count,
        has_video_carousel: enrichment.serpFeatures.has_video_carousel,
        avg_serp_word_count: enrichment.serpFeatures.avg_serp_word_count,
      }
    : null;

  // ── Structural guidance from fingerprint ───────────────────────────────────
  const structuralGuidance = enrichment.fingerprint
    ? {
        recommended_word_count_min: (enrichment.fingerprint as any).recommended_word_count_min,
        recommended_word_count_max: (enrichment.fingerprint as any).recommended_word_count_max,
        faq_usage_rate: (enrichment.fingerprint as any).faq_usage_rate,
        table_usage_rate: (enrichment.fingerprint as any).table_usage_rate,
        median_h2_count: (enrichment.fingerprint as any).median_h2_count,
        h2_patterns: (enrichment.fingerprint as any).h2_patterns,
        common_schema_types: (enrichment.fingerprint as any).common_schema_types,
        median_internal_links: (enrichment.fingerprint as any).median_internal_links,
        avg_position: (enrichment.fingerprint as any).avg_position,
      }
    : null;

  // ── Search volume + difficulty: keyword_volume_data > keyword_queue ────────
  let searchVolume: number | null = null;
  let keywordDifficulty: number | null = null;

  if (enrichment.keywordVolume) {
    searchVolume = enrichment.keywordVolume.search_volume;
    keywordDifficulty = enrichment.keywordVolume.keyword_difficulty;
  } else {
    let kqRow: KeywordQueueRow | null = null;
    const normalizedKeyword = gap.keyword.trim().toLowerCase();

    const normalizedLookup = await supabase
      .from('keyword_queue')
      .select('real_search_volume,keyword_difficulty,metadata')
      .eq('normalized_keyword', normalizedKeyword)
      .order('created_at', { ascending: false })
      .limit(1)
      .single<KeywordQueueRow>();

    if (normalizedLookup.error?.message?.includes('normalized_keyword')) {
      const legacyLookup = await supabase
        .from('keyword_queue')
        .select('real_search_volume,keyword_difficulty,metadata')
        .eq('primary_keyword', gap.keyword)
        .order('created_at', { ascending: false })
        .limit(1)
        .single<KeywordQueueRow>();

      kqRow = legacyLookup.data ?? null;
    } else {
      kqRow = normalizedLookup.data ?? null;
    }

    const meta = kqRow?.metadata ?? {};
    searchVolume =
      typeof kqRow?.real_search_volume === 'number'
        ? kqRow.real_search_volume
        : typeof meta.real_search_volume === 'number'
          ? (meta.real_search_volume as number)
          : null;
    keywordDifficulty =
      typeof kqRow?.keyword_difficulty === 'number'
        ? kqRow.keyword_difficulty
        : typeof meta.keyword_difficulty === 'number'
          ? (meta.keyword_difficulty as number)
          : null;
  }

  // ── Product specs (first match) ────────────────────────────────────────────
  const productSpecsSummary = enrichment.productSpecs.length > 0
    ? enrichment.productSpecs[0]
    : null;

  // ── Clinical trials (upcoming research) ───────────────────────────────────
  const upcomingResearch = enrichment.clinicalTrials.map((t: any) => ({
    nct_id: t.nct_id,
    title: t.title,
    status: t.status,
    phase: t.phase,
    sponsor: t.sponsor_name,
    primary_outcomes: t.primary_outcomes?.slice(0, 2),
    completion_date: t.completion_date,
  }));

  // ── App review sentiment ───────────────────────────────────────────────────
  const productSentiment = enrichment.appReviews.length > 0
    ? enrichment.appReviews[0]
    : null;

  // ── Schema type recommendation ─────────────────────────────────────────────
  const recommendedSchemas = [
    ...new Set([
      ...(enrichment.competitorAnalyses.flatMap((a) => a.schema_types ?? [])),
      ...((structuralGuidance?.common_schema_types as string[] | undefined) ?? []),
    ]),
  ].slice(0, 5);

  const { error } = await supabase.from('briefs').upsert(
    {
      page_slug: gap.page_slug,
      keyword: gap.keyword,
      target_word_count: targetWordCount,
      competitor_word_counts: competitorWordCounts,
      required_subtopics: requiredSubtopics,
      required_paa_answers: requiredPaaAnswers,
      competitor_weaknesses: competitorWeaknesses,
      search_volume: searchVolume,
      keyword_difficulty: keywordDifficulty,
      // New enrichment fields
      required_entities: requiredEntities,
      tfidf_entities: differentiatingEntities,
      community_questions: communityQuestions,
      positive_sentiment_phrases: positiveSentimentPhrases,
      serp_feature_context: serpFeatureContext,
      recommended_format: enrichment.serpFeatures?.recommended_format ?? null,
      serp_has_featured_snippet: enrichment.serpFeatures?.has_featured_snippet ?? false,
      serp_featured_snippet_type: enrichment.serpFeatures?.featured_snippet_type ?? null,
      structural_guidance: structuralGuidance,
      product_specs: productSpecsSummary,
      upcoming_research: upcomingResearch.length > 0 ? upcomingResearch : null,
      product_sentiment: productSentiment,
      recommended_schema_types: recommendedSchemas,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'page_slug' },
  );

  if (error) {
    console.warn(`[brief-generator] Failed to upsert brief for ${gap.page_slug}: ${error.message}`);
    return;
  }

  console.log(
    `[brief-generator] ${gap.page_slug}: ` +
    `target=${targetWordCount}w paa=${requiredPaaAnswers.length} ` +
    `entities=${requiredEntities.length} community_q=${communityQuestions.length} ` +
    `trials=${upcomingResearch.length} format=${serpFeatureContext?.recommended_format ?? 'standard'}`,
  );
}

async function run() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: gaps, error } = await supabase
    .from('content_gaps')
    .select('id, page_slug, keyword, cluster_slug, serp_snapshot, serp_features')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  if (!gaps || gaps.length === 0) {
    console.log('[brief-generator] No new content gaps found — nothing to brief.');
    return;
  }

  console.log(`[brief-generator] Generating enriched briefs for ${gaps.length} gap(s)...`);

  for (const gap of gaps as ContentGapRow[]) {
    await generateBrief(gap);
  }

  console.log('[brief-generator] Brief generation complete.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
