import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LOOKBACK_DAYS = Number(process.env.FEEDBACK_LOOKBACK_DAYS ?? 28);
const CONVERSION_LOOKBACK_DAYS = Number(process.env.FEEDBACK_CONVERSION_LOOKBACK_DAYS ?? 90);
const TOP_PERFORMERS_PER_TEMPLATE = Number(process.env.FEEDBACK_TOP_PERFORMERS ?? 12);
const MIN_COMPONENT_SAMPLES = Number(process.env.FEEDBACK_MIN_COMPONENT_SAMPLES ?? 2);
const MAX_COMPONENT_WEIGHT_SHIFT = Number(process.env.FEEDBACK_MAX_COMPONENT_WEIGHT_SHIFT ?? 0.18);
const MIN_COMPONENT_WEIGHT = Number(process.env.FEEDBACK_MIN_COMPONENT_WEIGHT ?? 0.5);
const MAX_COMPONENT_WEIGHT = Number(process.env.FEEDBACK_MAX_COMPONENT_WEIGHT ?? 3);

type JsonObject = Record<string, unknown>;

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  intro: string | null;
  primary_keyword: string | null;
  metadata: JsonObject | null;
  body_json: JsonObject | null;
  internal_links: unknown[] | null;
};

type MetricRow = {
  page_slug: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
};

type ConversionRow = {
  slug: string | null;
  cta: string;
};

type QualityRow = {
  page_id: string;
  total_score: number;
  created_at: string;
};

type AggregatedMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number | null;
};

type PageFeedback = {
  page: PageRow;
  metrics: AggregatedMetrics;
  conversions90d: number;
  qualityScore: number;
  performanceScore: number;
  componentIds: Record<string, string>;
  sectionKinds: string[];
  sectionCount: number;
  faqCount: number;
  h2Count: number;
  h3Count: number;
  wordCount: number;
  internalLinkCount: number;
  hasComparisonTable: boolean;
  hasDefinitionBox: boolean;
  hasNumberedList: boolean;
};

type ComponentRow = {
  id: string;
  cluster: string;
  name: string;
  weight: number;
  active: boolean;
};

type ComponentStat = {
  count: number;
  scoreSum: number;
  conversionSum: number;
  impressionSum: number;
};

type PublishedPagesResult = {
  pages: PageRow[];
  supportsMetadata: boolean;
};

function isMissingRelationError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pickLatestQuality(rows: QualityRow[]) {
  const latestByPage = new Map<string, QualityRow>();
  for (const row of rows) {
    const existing = latestByPage.get(row.page_id);
    if (!existing || row.created_at > existing.created_at) {
      latestByPage.set(row.page_id, row);
    }
  }
  return latestByPage;
}

function aggregateMetrics(rows: MetricRow[]) {
  const bySlug = new Map<string, { clicks: number; impressions: number; positionWeighted: number; positionImpressions: number }>();

  for (const row of rows) {
    const slug = String(row.page_slug ?? '').trim();
    if (!slug) continue;

    const clicks = Number(row.clicks ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const position = Number(row.position ?? 0);
    const current = bySlug.get(slug) ?? { clicks: 0, impressions: 0, positionWeighted: 0, positionImpressions: 0 };

    current.clicks += clicks;
    current.impressions += impressions;
    if (impressions > 0 && position > 0) {
      current.positionWeighted += position * impressions;
      current.positionImpressions += impressions;
    }

    bySlug.set(slug, current);
  }

  const output = new Map<string, AggregatedMetrics>();
  for (const [slug, value] of bySlug.entries()) {
    output.set(slug, {
      clicks: value.clicks,
      impressions: value.impressions,
      ctr: value.impressions > 0 ? value.clicks / value.impressions : 0,
      avgPosition: value.positionImpressions > 0 ? value.positionWeighted / value.positionImpressions : null,
    });
  }
  return output;
}

function aggregateConversions(rows: ConversionRow[]) {
  const bySlug = new Map<string, number>();
  for (const row of rows) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) continue;
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + 1);
  }
  return bySlug;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

function extractSectionData(body: JsonObject | null) {
  const sections = Array.isArray(body?.sections) ? body.sections as Array<Record<string, unknown>> : [];
  const sectionKinds = sections
    .map((section) => String(section.kind ?? '').trim())
    .filter(Boolean);
  const faqCount = Array.isArray(body?.faqs)
    ? body.faqs.length
    : sections
        .filter((section) => String(section.kind ?? '') === 'faq')
        .flatMap((section) => Array.isArray((section.content as Record<string, unknown> | undefined)?.items) ? ((section.content as Record<string, unknown>).items as unknown[]) : [])
        .length;
  const h2Count = sections.length;
  const h3Count = sections.reduce((count, section) => {
    const content = section.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) return count;
    const nested = (content as Record<string, unknown>).items;
    return count + (Array.isArray(nested) ? nested.filter((item) => item && typeof item === 'object').length : 0);
  }, 0);
  const hasComparisonTable = Boolean(body?.comparison_table) || sections.some((section) => String(section.kind ?? '') === 'table');
  const hasDefinitionBox = sections.some((section) => String(section.kind ?? '') === 'definition_box');
  const hasNumberedList = sections.some((section) => {
    const kind = String(section.kind ?? '');
    if (kind === 'steps') return true;
    if (kind !== 'list') return false;
    const content = section.content;
    return Array.isArray(content) || Array.isArray((content as Record<string, unknown> | undefined)?.items);
  });

  return {
    sectionKinds,
    sectionCount: sections.length,
    faqCount,
    h2Count,
    h3Count,
    hasComparisonTable,
    hasDefinitionBox,
    hasNumberedList,
  };
}

function computeWordCount(page: PageRow) {
  const bodyText = collectStrings(page.body_json).join(' ');
  const intro = page.intro ?? '';
  return `${page.title} ${intro} ${bodyText}`
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function extractComponentIds(body: JsonObject | null) {
  const generationMetadata = body?.generation_metadata;
  if (!generationMetadata || typeof generationMetadata !== 'object' || Array.isArray(generationMetadata)) {
    return {};
  }

  const ids = (generationMetadata as Record<string, unknown>).component_ids;
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(ids as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      output[key] = value.trim();
    }
  }
  return output;
}

function computePerformanceScore(metrics: AggregatedMetrics, conversions90d: number, qualityScore: number) {
  const impressionsScore = clamp(Math.log10(metrics.impressions + 1) / 4, 0, 1);
  const ctrScore = clamp(metrics.ctr / 0.08, 0, 1);
  const positionScore = metrics.avgPosition != null ? clamp((20 - metrics.avgPosition) / 19, 0, 1) : 0;
  const conversionRate = metrics.impressions > 0 ? conversions90d / metrics.impressions : 0;
  const conversionScore = clamp(conversionRate / 0.005, 0, 1);
  const qualityScoreNormalized = clamp(qualityScore / 100, 0, 1);

  return round(
    (
      impressionsScore * 0.18 +
      ctrScore * 0.24 +
      positionScore * 0.22 +
      conversionScore * 0.18 +
      qualityScoreNormalized * 0.18
    ) * 100,
    2,
  );
}

function deriveOpeningPatterns(pages: PageFeedback[]) {
  const patterns = new Map<string, number>();

  for (const page of pages) {
    const intro = (page.page.intro ?? '').trim().toLowerCase();
    let pattern = 'statement';
    if (!intro) pattern = 'missing_intro';
    else if (/^\d/.test(intro)) pattern = 'stat_led';
    else if (intro.endsWith('?')) pattern = 'question_led';
    else if (/^(what|how|why|when|which)\b/.test(intro)) pattern = 'definition_led';
    else if (/^(use|start|follow|build|compare)\b/.test(intro)) pattern = 'command_led';

    patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
  }

  return [...patterns.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label]) => label);
}

function mostCommon<T>(values: T[], minShare = 0.3) {
  if (!values.length) return [];
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(1, Math.ceil(values.length * minShare));
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

async function maybeUpsert(table: string, rows: JsonObject | JsonObject[], onConflict?: string) {
  try {
    const query = supabase.from(table).upsert(rows as never, onConflict ? { onConflict } : undefined as never);
    const { error } = await query;
    if (error) {
      console.warn(`[feedback-loop] ${table} upsert skipped: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[feedback-loop] ${table} upsert skipped: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function maybeUpdateQueryTargets(feedbackRows: PageFeedback[]) {
  const updates = feedbackRows
    .filter((row) => row.page.id)
    .map((row) => ({
      page_id: row.page.id,
      current_ctr: row.metrics.impressions > 0 ? round(row.metrics.ctr, 4) : null,
      current_position: row.metrics.avgPosition != null ? round(row.metrics.avgPosition, 2) : null,
      metadata: {
        feedback_updated_at: new Date().toISOString(),
        performance_score: row.performanceScore,
        conversions_90d: row.conversions90d,
      },
    }));

  for (const update of updates) {
    try {
      const { error } = await supabase
        .from('page_query_targets')
        .update({
          current_ctr: update.current_ctr,
          current_position: update.current_position,
          metadata: update.metadata,
        })
        .eq('page_id', update.page_id);

      if (error) {
        console.warn(`[feedback-loop] page_query_targets update skipped: ${error.message}`);
        return;
      }
    } catch (error) {
      console.warn(`[feedback-loop] page_query_targets update skipped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
}

async function updatePageMetadata(feedbackRows: PageFeedback[], supportsMetadata: boolean) {
  if (!supportsMetadata) {
    console.log('[feedback-loop] pages.metadata not available on this schema - skipping page metadata feedback writes.');
    return;
  }

  for (const row of feedbackRows) {
    const metadata = {
      ...(row.page.metadata ?? {}),
      feedback_summary: {
        lookback_days: LOOKBACK_DAYS,
        clicks_28d: row.metrics.clicks,
        impressions_28d: row.metrics.impressions,
        ctr_28d: round(row.metrics.ctr, 4),
        avg_position_28d: row.metrics.avgPosition != null ? round(row.metrics.avgPosition, 2) : null,
        conversions_90d: row.conversions90d,
        quality_score: row.qualityScore,
        performance_score: row.performanceScore,
        updated_at: new Date().toISOString(),
      },
    };

    const { error } = await supabase.from('pages').update({ metadata }).eq('id', row.page.id);
    if (error) {
      console.warn(`[feedback-loop] Failed to update page metadata for ${row.page.slug}: ${error.message}`);
    }
  }
}

async function loadPublishedPages(): Promise<PublishedPagesResult> {
  const withMetadata = await supabase
    .from('pages')
    .select('id,slug,template,title,intro,primary_keyword,metadata,body_json,internal_links')
    .eq('status', 'published')
    .limit(500);

  if (!withMetadata.error) {
    return {
      pages: (withMetadata.data ?? []) as PageRow[],
      supportsMetadata: true,
    };
  }

  if (withMetadata.error.code !== '42703') {
    throw withMetadata.error;
  }

  console.warn('[feedback-loop] pages.metadata column missing - falling back to compatibility mode.');
  const withoutMetadata = await supabase
    .from('pages')
    .select('id,slug,template,title,intro,primary_keyword,body_json,internal_links')
    .eq('status', 'published')
    .limit(500);

  if (withoutMetadata.error) throw withoutMetadata.error;

  return {
    pages: (withoutMetadata.data ?? []).map((row: any) => ({ ...row, metadata: null })) as PageRow[],
    supportsMetadata: false,
  };
}

async function loadMetrics(metricsSince: string) {
  const result = await supabase
    .from('page_metrics_daily')
    .select('page_slug,clicks,impressions,ctr,position')
    .gte('date', metricsSince)
    .limit(10000);

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      console.warn('[feedback-loop] page_metrics_daily missing - continuing without search-performance metrics.');
      return [] as MetricRow[];
    }
    throw result.error;
  }

  return (result.data ?? []) as MetricRow[];
}

async function loadConversions(conversionsSince: string) {
  const result = await supabase
    .from('conversion_events')
    .select('slug,cta')
    .gte('created_at', conversionsSince)
    .limit(10000);

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      console.warn('[feedback-loop] conversion_events missing - continuing without conversion data.');
      return [] as ConversionRow[];
    }
    throw result.error;
  }

  return (result.data ?? []) as ConversionRow[];
}

async function loadQualityScores() {
  const result = await supabase
    .from('page_quality_scores')
    .select('page_id,total_score,created_at')
    .eq('score_type', 'seo_quality')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      console.warn('[feedback-loop] page_quality_scores missing - falling back to default quality scores.');
      return [] as QualityRow[];
    }
    throw result.error;
  }

  return (result.data ?? []) as QualityRow[];
}

async function updateComponentWeights(feedbackRows: PageFeedback[]) {
  const { data, error } = await supabase
    .from('component_library')
    .select('id,cluster,name,weight,active');

  if (error) throw error;

  const componentRows = (data ?? []) as ComponentRow[];
  const byId = new Map(componentRows.map((row) => [row.id, row]));
  const statsByComponent = new Map<string, ComponentStat>();
  const globalAverage = average(feedbackRows.map((row) => row.performanceScore));

  for (const row of feedbackRows) {
    for (const componentId of Object.values(row.componentIds)) {
      if (!byId.has(componentId)) continue;
      const current = statsByComponent.get(componentId) ?? { count: 0, scoreSum: 0, conversionSum: 0, impressionSum: 0 };
      current.count += 1;
      current.scoreSum += row.performanceScore;
      current.conversionSum += row.conversions90d;
      current.impressionSum += row.metrics.impressions;
      statsByComponent.set(componentId, current);
    }
  }

  let updated = 0;
  for (const [componentId, stat] of statsByComponent.entries()) {
    if (stat.count < MIN_COMPONENT_SAMPLES) continue;
    const row = byId.get(componentId);
    if (!row || !row.active) continue;

    const avgScore = stat.scoreSum / stat.count;
    const relativeLift = clamp((avgScore - globalAverage) / 100, -MAX_COMPONENT_WEIGHT_SHIFT, MAX_COMPONENT_WEIGHT_SHIFT);
    const conversionRatePerImpression = stat.impressionSum > 0 ? stat.conversionSum / stat.impressionSum : 0;
    const conversionBonus = clamp(conversionRatePerImpression / 0.01, 0, 1) * 0.03;
    const nextWeight = clamp(row.weight * (1 + relativeLift + conversionBonus), MIN_COMPONENT_WEIGHT, MAX_COMPONENT_WEIGHT);

    if (Math.abs(nextWeight - row.weight) < 0.02) continue;

    const { error: updateError } = await supabase
      .from('component_library')
      .update({ weight: round(nextWeight, 3) })
      .eq('id', componentId);

    if (updateError) {
      console.warn(`[feedback-loop] Failed to update component ${row.name}: ${updateError.message}`);
      continue;
    }

    updated += 1;
  }

  return { updated, sampled: statsByComponent.size, globalAverage: round(globalAverage, 2) };
}

async function updatePerformanceFingerprints(feedbackRows: PageFeedback[]) {
  const grouped = new Map<string, PageFeedback[]>();
  for (const row of feedbackRows) {
    const current = grouped.get(row.page.template) ?? [];
    current.push(row);
    grouped.set(row.page.template, current);
  }

  const rows: JsonObject[] = [];
  for (const [template, pages] of grouped.entries()) {
    const top = [...pages]
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, TOP_PERFORMERS_PER_TEMPLATE);

    if (top.length === 0) continue;

    const titleLengths = top.map((page) => page.page.title.length);
    const faqCounts = top.map((page) => page.faqCount);
    const wordCounts = top.map((page) => page.wordCount).filter((count) => count > 0).sort((a, b) => a - b);
    const topCtrPages = [...top]
      .filter((page) => page.metrics.impressions > 0)
      .sort((a, b) => b.metrics.ctr - a.metrics.ctr)
      .slice(0, Math.max(1, Math.ceil(top.length / 3)));
    const bestCtrFaqCount = topCtrPages.length ? Math.round(average(topCtrPages.map((page) => page.faqCount))) : 0;
    const wordRangeMin = wordCounts.length ? wordCounts[Math.floor(wordCounts.length * 0.25)] : 0;
    const wordRangeMax = wordCounts.length ? wordCounts[Math.floor(wordCounts.length * 0.75)] : 0;

    rows.push({
      template,
      avg_word_count: Math.round(average(top.map((page) => page.wordCount))),
      avg_section_count: Math.round(average(top.map((page) => page.sectionCount))),
      avg_faq_count: Math.round(average(faqCounts)),
      avg_internal_links: Math.round(average(top.map((page) => page.internalLinkCount))),
      avg_h2_count: Math.round(average(top.map((page) => page.h2Count))),
      avg_h3_count: Math.round(average(top.map((page) => page.h3Count))),
      top_performers: top.map((page) => ({
        slug: page.page.slug,
        title: page.page.title,
        performance_score: page.performanceScore,
        clicks: page.metrics.clicks,
        impressions: page.metrics.impressions,
        ctr: round(page.metrics.ctr, 4),
        position: page.metrics.avgPosition != null ? round(page.metrics.avgPosition, 2) : null,
        conversions_90d: page.conversions90d,
      })),
      top_performer_count: top.length,
      common_section_types: mostCommon(top.flatMap((page) => page.sectionKinds), 0.25),
      common_opening_patterns: deriveOpeningPatterns(top),
      stat_in_first_heading: top.some((page) => {
        const first = Array.isArray(page.page.body_json?.sections) ? page.page.body_json.sections[0] as Record<string, unknown> | undefined : undefined;
        const heading = String(first?.heading ?? '');
        return /\d/.test(heading);
      }),
      comparison_table_present: top.filter((page) => page.hasComparisonTable).length / top.length >= 0.5,
      definition_box_present: top.filter((page) => page.hasDefinitionBox).length / top.length >= 0.35,
      numbered_list_present: top.filter((page) => page.hasNumberedList).length / top.length >= 0.5,
      avg_title_length: Math.round(average(titleLengths)),
      title_starts_with_number: top.filter((page) => /^\d/.test(page.page.title)).length / top.length >= 0.25,
      title_has_year: top.filter((page) => /\b20\d{2}\b/.test(page.page.title)).length / top.length >= 0.2,
      title_has_brackets: top.filter((page) => /[\[\(].*[\]\)]/.test(page.page.title)).length / top.length >= 0.2,
      clicks_per_word_count: round(
        average(top.map((page) => page.metrics.clicks / Math.max(page.wordCount, 1))),
        6,
      ),
      best_ctr_faq_count: bestCtrFaqCount,
      best_ctr_word_range: wordRangeMin && wordRangeMax ? `${wordRangeMin}-${wordRangeMax}` : null,
      computed_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) return 0;
  const ok = await maybeUpsert('performance_fingerprints', rows, 'template');
  return ok ? rows.length : 0;
}

async function openAdaptiveReviewSignals(feedbackRows: PageFeedback[]) {
  const queueRows: JsonObject[] = [];
  const signalRows: JsonObject[] = [];

  for (const row of feedbackRows) {
    if (row.metrics.impressions >= 250 && row.metrics.ctr < 0.015) {
      queueRows.push({
        page_id: row.page.id,
        page_slug: row.page.slug,
        review_type: 'ctr_recovery_review',
        priority: 76,
        status: 'open',
        rationale: 'Page has meaningful impressions but weak CTR over the last 28 days.',
        payload: {
          impressions_28d: row.metrics.impressions,
          ctr_28d: round(row.metrics.ctr, 4),
          avg_position_28d: row.metrics.avgPosition != null ? round(row.metrics.avgPosition, 2) : null,
          performance_score: row.performanceScore,
        },
      });
      signalRows.push({
        page_id: row.page.id,
        page_slug: row.page.slug,
        signal_type: 'low_ctr',
        severity: 70,
        status: 'open',
        detail: `CTR ${round(row.metrics.ctr * 100, 2)}% on ${row.metrics.impressions} impressions over ${LOOKBACK_DAYS}d`,
        metadata: {
          impressions_28d: row.metrics.impressions,
          ctr_28d: round(row.metrics.ctr, 4),
          avg_position_28d: row.metrics.avgPosition != null ? round(row.metrics.avgPosition, 2) : null,
        },
      });
    }

    if (row.metrics.impressions >= 300 && row.conversions90d === 0) {
      queueRows.push({
        page_id: row.page.id,
        page_slug: row.page.slug,
        review_type: 'conversion_path_review',
        priority: 72,
        status: 'open',
        rationale: 'Page receives search demand but has not produced recent tracked conversions.',
        payload: {
          impressions_28d: row.metrics.impressions,
          clicks_28d: row.metrics.clicks,
          conversions_90d: row.conversions90d,
          performance_score: row.performanceScore,
        },
      });
    }

    if (row.performanceScore < 45 || row.qualityScore < 60) {
      signalRows.push({
        page_id: row.page.id,
        page_slug: row.page.slug,
        signal_type: 'adaptive_underperformance',
        severity: Math.max(55, Math.round(100 - row.performanceScore)),
        status: 'open',
        detail: `Performance score ${row.performanceScore} with quality ${row.qualityScore}`,
        metadata: {
          quality_score: row.qualityScore,
          performance_score: row.performanceScore,
          conversions_90d: row.conversions90d,
          impressions_28d: row.metrics.impressions,
        },
      });
    }
  }

  const queueOk = queueRows.length
    ? await maybeUpsert('editorial_review_queue', queueRows, 'page_id,review_type,status')
    : true;
  const signalOk = signalRows.length
    ? await maybeUpsert('page_refresh_signals', signalRows, 'page_id,signal_type,status')
    : true;

  return {
    queueRows: queueOk ? queueRows.length : 0,
    signalRows: signalOk ? signalRows.length : 0,
  };
}

async function run() {
  const metricsSince = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const conversionsSince = new Date(Date.now() - CONVERSION_LOOKBACK_DAYS * 86_400_000).toISOString();

  const [pagesResult, metricRows, conversionRows, qualityRows] = await Promise.all([
    loadPublishedPages(),
    loadMetrics(metricsSince),
    loadConversions(conversionsSince),
    loadQualityScores(),
  ]);

  const pages = pagesResult.pages;
  if (pages.length === 0) {
    console.log('[feedback-loop] No published pages found.');
    return;
  }

  const metricsBySlug = aggregateMetrics(metricRows);
  const conversionsBySlug = aggregateConversions(conversionRows);
  const latestQualityByPage = pickLatestQuality(qualityRows);

  const feedbackRows: PageFeedback[] = pages.map((page) => {
    const metrics = metricsBySlug.get(page.slug) ?? { clicks: 0, impressions: 0, ctr: 0, avgPosition: null };
    const qualityScore = Number(latestQualityByPage.get(page.id)?.total_score ?? page.metadata?.seo_quality_score ?? 55);
    const conversions90d = conversionsBySlug.get(page.slug) ?? 0;
    const componentIds = extractComponentIds(page.body_json);
    const sectionData = extractSectionData(page.body_json);
    const wordCount = computeWordCount(page);

    return {
      page,
      metrics,
      conversions90d,
      qualityScore,
      performanceScore: computePerformanceScore(metrics, conversions90d, qualityScore),
      componentIds,
      ...sectionData,
      wordCount,
      internalLinkCount: Array.isArray(page.internal_links) ? page.internal_links.length : 0,
    };
  });

  await updatePageMetadata(feedbackRows, pagesResult.supportsMetadata);
  await maybeUpdateQueryTargets(feedbackRows);
  const componentSummary = await updateComponentWeights(feedbackRows);
  const fingerprintCount = await updatePerformanceFingerprints(feedbackRows);
  const reviewSummary = await openAdaptiveReviewSignals(feedbackRows);

  const topPages = [...feedbackRows]
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, 5)
    .map((row) => `${row.page.slug}:${row.performanceScore}`);

  console.log(
    `[feedback-loop] pages=${feedbackRows.length} component_updates=${componentSummary.updated}/${componentSummary.sampled} fingerprints=${fingerprintCount} review_queue=${reviewSummary.queueRows} refresh_signals=${reviewSummary.signalRows} global_avg=${componentSummary.globalAverage}`,
  );
  console.log(`[feedback-loop] top_pages=${topPages.join(', ')}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
