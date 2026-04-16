import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  buildReferenceRow,
  deriveWordCountTarget,
  inferQueryIntent,
  normalizeSeoText,
  type QueryTargetRow,
} from '@/lib/seo-planning';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  metadata: Record<string, unknown> | null;
};

type GapRow = {
  page_slug: string;
  keyword: string;
  serp_snapshot?: {
    top_results?: Array<{ title?: string; link?: string; snippet?: string }>;
    people_also_ask?: Array<{ question: string }>;
    related_searches?: Array<{ query: string }>;
  };
};

type BriefRow = {
  page_slug: string;
  target_word_count: number | null;
  required_subtopics: string[];
  required_paa_answers: string[];
  search_volume: number | null;
  keyword_difficulty: number | null;
};

function buildVisualPlan(page: PageRow, targetWords: number) {
  const templates = [
    {
      asset_kind: 'hero',
      purpose: 'hero',
      sort_order: 0,
      alt_text: `${page.title} hero illustration`,
      metadata: {
        prompt_hint: `Hero visual for ${page.primary_keyword ?? page.title}`,
        recommended_width: 1200,
      },
    },
    {
      asset_kind: page.template === 'reviews' || page.template === 'alternatives' ? 'comparison-chart' : 'explanatory-diagram',
      purpose: 'body_support',
      sort_order: 1,
      alt_text: `${page.title} comparison and decision support graphic`,
      metadata: {
        prompt_hint: `Support graphic for ${page.title} focused on the main trade-offs`,
        recommended_after_words: Math.round(targetWords * 0.33),
      },
    },
    {
      asset_kind: page.template === 'protocols' ? 'step-flow' : 'key-takeaway-graphic',
      purpose: 'body_support',
      sort_order: 2,
      alt_text: `${page.title} key takeaways visual`,
      metadata: {
        prompt_hint: `Secondary support graphic for ${page.title} focused on implementation takeaways`,
        recommended_after_words: Math.round(targetWords * 0.66),
      },
    },
  ];

  return templates;
}

async function run() {
  const [pagesResult, gapsResult, briefsResult] = await Promise.all([
    supabase
      .from('pages')
      .select('id,slug,template,title,primary_keyword,secondary_keywords,metadata')
      .in('status', ['draft', 'approved', 'published'])
      .limit(250),
    supabase
      .from('content_gaps')
      .select('page_slug,keyword,serp_snapshot')
      .order('created_at', { ascending: false })
      .limit(250),
    supabase
      .from('briefs')
      .select('page_slug,target_word_count,required_subtopics,required_paa_answers,search_volume,keyword_difficulty')
      .order('generated_at', { ascending: false })
      .limit(250),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  if (gapsResult.error) throw gapsResult.error;
  if (briefsResult.error) throw briefsResult.error;

  const pages = (pagesResult.data ?? []) as PageRow[];
  const gapsBySlug = new Map<string, GapRow>();
  for (const row of (gapsResult.data ?? []) as GapRow[]) {
    if (!gapsBySlug.has(row.page_slug)) gapsBySlug.set(row.page_slug, row);
  }

  const briefsBySlug = new Map<string, BriefRow>();
  for (const row of (briefsResult.data ?? []) as BriefRow[]) {
    if (!briefsBySlug.has(row.page_slug)) briefsBySlug.set(row.page_slug, row);
  }

  let queryRowsWritten = 0;
  let referenceRowsWritten = 0;
  let visualRowsWritten = 0;

  for (const page of pages) {
    const brief = briefsBySlug.get(page.slug);
    const gap = gapsBySlug.get(page.slug);

    const rawQueries = [
      page.primary_keyword,
      ...(page.secondary_keywords ?? []),
      ...(brief?.required_subtopics ?? []),
      ...(brief?.required_paa_answers ?? []),
      ...((gap?.serp_snapshot?.people_also_ask ?? []).map((item) => item.question)),
      ...((gap?.serp_snapshot?.related_searches ?? []).map((item) => item.query)),
    ].filter((item): item is string => Boolean(item && item.trim()));

    const uniqueQueries = Array.from(new Map(rawQueries.map((query) => [normalizeSeoText(query), query.trim()])).entries());
    const queryRows: QueryTargetRow[] = uniqueQueries.slice(0, 20).map(([normalizedQuery, query], index) => ({
      page_id: page.id,
      page_slug: page.slug,
      query,
      normalized_query: normalizedQuery,
      intent: inferQueryIntent(query),
      source:
        page.primary_keyword && normalizeSeoText(page.primary_keyword) === normalizedQuery
          ? 'primary_keyword'
          : brief?.required_paa_answers.includes(query)
            ? 'brief_paa'
            : brief?.required_subtopics.includes(query)
              ? 'brief_subtopic'
              : (gap?.serp_snapshot?.people_also_ask ?? []).some((item) => normalizeSeoText(item.question) === normalizedQuery)
                ? 'paa'
                : 'related_search',
      priority: Math.max(30, 100 - index * 3),
      search_volume: brief?.search_volume ?? null,
      keyword_difficulty: brief?.keyword_difficulty ?? null,
      is_primary: index === 0,
      cluster_label: page.template,
      metadata: {
        page_template: page.template,
      },
    }));

    if (queryRows.length > 0) {
      const { error } = await supabase.from('page_query_targets').upsert(queryRows, {
        onConflict: 'page_id,normalized_query',
      });
      if (error) throw error;
      queryRowsWritten += queryRows.length;
    }

    const topResults = gap?.serp_snapshot?.top_results ?? [];
    const referenceRows = topResults
      .filter((item) => item.link && item.title)
      .slice(0, 8)
      .map((item, index) =>
        buildReferenceRow(page.id, page.slug, {
          title: item.title!,
          url: item.link!,
          source_type: 'serp_competitor',
          evidence_level: index < 3 ? 'primary' : 'supporting',
          metadata: {
            serp_keyword: gap?.keyword ?? page.primary_keyword,
            snippet: item.snippet ?? null,
          },
        }),
      );

    if (referenceRows.length > 0) {
      const { error } = await supabase.from('page_source_references').upsert(referenceRows, {
        onConflict: 'page_id,url',
      });
      if (error) throw error;
      referenceRowsWritten += referenceRows.length;
    }

    const targetWords = deriveWordCountTarget(
      { template: page.template as any },
      queryRows.length,
      referenceRows.length,
      brief?.target_word_count ?? null,
    );

    const visualPlanRows = buildVisualPlan(page, targetWords).map((asset) => ({
      page_id: page.id,
      page_slug: page.slug,
      asset_kind: asset.asset_kind,
      purpose: asset.purpose,
      status: 'planned',
      sort_order: asset.sort_order,
      alt_text: asset.alt_text,
      metadata: asset.metadata,
    }));

    const { error: visualError } = await supabase.from('page_visual_assets').upsert(visualPlanRows, {
      onConflict: 'page_id,asset_kind,sort_order',
      ignoreDuplicates: false,
    } as any);

    if (!visualError) {
      visualRowsWritten += visualPlanRows.length;
    }

    const nextMetadata = {
      ...(page.metadata ?? {}),
      target_word_count: targetWords,
      query_target_count: queryRows.length,
      reference_target_count: referenceRows.length,
      visual_asset_target_count: visualPlanRows.length,
      planner_synced_at: new Date().toISOString(),
    };

    await supabase.from('pages').update({ metadata: nextMetadata }).eq('id', page.id);
  }

  console.log(
    `[query-coverage-planner] planned pages=${pages.length} query_targets=${queryRowsWritten} references=${referenceRowsWritten} visual_assets=${visualRowsWritten}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
