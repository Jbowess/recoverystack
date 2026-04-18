/**
 * SERP Feature Detector
 *
 * Analyses Google SERP results for each draft/queued keyword and detects
 * which SERP features are present. This determines the recommended page
 * format before content generation runs.
 *
 * Detects:
 *   - Featured snippet (and its type: paragraph | ordered_list | unordered_list | table)
 *   - Knowledge panel
 *   - Video carousel
 *   - Image pack
 *   - Shopping results
 *   - News results (indicates topical / freshness opportunity)
 *   - Local pack
 *   - PAA tree with expanded sub-questions
 *   - Average word count of top organic results
 *
 * Recommended format mapping:
 *   featured snippet = paragraph → use concise definition + paragraph intro
 *   featured snippet = ordered_list → use numbered steps/list at top
 *   featured snippet = table → use comparison table in H2 position
 *   video carousel → include video embed placeholder + transcript-style section
 *   no featured snippet → use standard guide format
 *
 * Output: writes to `serp_features` table, updates `content_gaps.serp_features`.
 *
 * Usage:
 *   npx tsx scripts/serp-feature-detector.ts
 *   SERP_FEATURE_LIMIT=50 npx tsx scripts/serp-feature-detector.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SERPAPI_KEY = process.env.SERPAPI_API_KEY;
const LIMIT = Number(process.env.SERP_FEATURE_LIMIT ?? 40);
// Refresh features after 3 days — SERP features change over time
const REFRESH_AFTER_HOURS = Number(process.env.SERP_FEATURE_REFRESH_H ?? 72);

type SerpFeaturesRow = {
  keyword: string;
  page_slug?: string | null;
  has_featured_snippet: boolean;
  featured_snippet_type: string | null;
  featured_snippet_url: string | null;
  featured_snippet_domain: string | null;
  featured_snippet_text: string | null;
  has_knowledge_panel: boolean;
  has_video_carousel: boolean;
  has_image_pack: boolean;
  has_shopping_results: boolean;
  has_news_results: boolean;
  has_local_pack: boolean;
  has_site_links: boolean;
  paa_questions: unknown[];
  paa_count: number;
  top_domain_types: string[];
  avg_serp_word_count: number | null;
  result_count: string | null;
  recommended_format: string;
  queried_at: string;
};

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Determine featured snippet type from SerpAPI answer_box + snippet data.
 */
function detectSnippetType(answerBox: Record<string, unknown> | null, snippet: string | null): string {
  if (!answerBox && !snippet) return 'paragraph';

  // SerpAPI answer_box type field
  const abType = String(answerBox?.type ?? '').toLowerCase();
  if (abType === 'organic_result') {
    // Check if it looks like a list
    const list = answerBox?.list as string[] | undefined;
    if (Array.isArray(list) && list.length > 0) return 'unordered_list';
    const orderedList = answerBox?.numbered_items as unknown[] | undefined;
    if (Array.isArray(orderedList) && orderedList.length > 0) return 'ordered_list';
  }
  if (abType === 'table') return 'table';
  if (abType === 'list') return 'unordered_list';
  if (abType === 'steps' || abType === 'numbered_list') return 'ordered_list';

  // Heuristic from snippet text
  if (snippet) {
    if (/^\d+\.\s/.test(snippet) || /\n\d+\.\s/.test(snippet)) return 'ordered_list';
    if (/^[-•]\s/.test(snippet) || /\n[-•]\s/.test(snippet)) return 'unordered_list';
    if (/\|/.test(snippet)) return 'table';
  }

  return 'paragraph';
}

/**
 * Map SERP features + snippet type to a recommended content format.
 */
function recommendFormat(features: Partial<SerpFeaturesRow>): string {
  if (features.has_featured_snippet) {
    switch (features.featured_snippet_type) {
      case 'ordered_list': return 'numbered_list';
      case 'unordered_list': return 'unordered_list';
      case 'table': return 'table';
      default: return 'paragraph';
    }
  }
  if (features.has_video_carousel) return 'how_to';
  if (features.has_shopping_results) return 'comparison_table';
  if (features.has_news_results) return 'news_brief';
  return 'standard_guide';
}

/**
 * Classify a domain as publisher/brand/aggregator/ecommerce/wiki based on URL patterns.
 */
function classifyDomainType(url: string): string {
  const domain = extractDomain(url).toLowerCase();
  if (/wikipedia\.org|wiki\./.test(domain)) return 'wiki';
  if (/reddit\.com|quora\.com|stackexchange|forum/.test(domain)) return 'community';
  if (/amazon\.|ebay\.|bestbuy\.|walmart\.|shop\./.test(domain)) return 'ecommerce';
  if (/whoop\.|ouraring\.|garmin\.|polar\.|eight|therabody|withings/.test(domain)) return 'brand';
  if (/healthline|webmd|mayo|verywellfit|menshealth|runnersworld|outsideonline/.test(domain)) return 'publisher';
  return 'other';
}

async function fetchSerpFeatures(keyword: string): Promise<SerpFeaturesRow | null> {
  if (!SERPAPI_KEY) return null;

  try {
    await rateLimit('serpapi');

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', keyword);
    url.searchParams.set('num', '10');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('gl', 'au');
    url.searchParams.set('api_key', SERPAPI_KEY);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[serp-features] SerpAPI error ${res.status} for "${keyword}"`);
      return null;
    }

    const payload = await res.json();

    // ── Featured snippet ──────────────────────────────────────────────────────
    const answerBox = (payload?.answer_box as Record<string, unknown>) ?? null;
    const hasFeaturedSnippet = !!answerBox;
    const answerBoxSource = answerBox?.source && typeof answerBox.source === 'object'
      ? answerBox.source as Record<string, unknown>
      : null;
    const snippetType = hasFeaturedSnippet
      ? detectSnippetType(answerBox, String(answerBox?.snippet ?? answerBox?.answer ?? ''))
      : null;
    const snippetUrl = String(answerBox?.link ?? answerBoxSource?.link ?? '').trim() || null;
    const snippetDomain = snippetUrl ? extractDomain(snippetUrl) : null;
    const snippetText = String(answerBox?.snippet ?? answerBox?.answer ?? answerBox?.result ?? '').trim().slice(0, 500) || null;

    // ── Other SERP features ───────────────────────────────────────────────────
    const hasKnowledgePanel = !!payload?.knowledge_graph;
    const hasVideoCarousel = Array.isArray(payload?.inline_videos) && payload.inline_videos.length > 0;
    const hasImagePack = Array.isArray(payload?.inline_images) && payload.inline_images.length > 0;
    const hasShoppingResults = Array.isArray(payload?.shopping_results) && payload.shopping_results.length > 0;
    const hasNewsResults = Array.isArray(payload?.news_results) && payload.news_results.length > 0;
    const hasLocalPack = Array.isArray(payload?.local_results) && payload.local_results.length > 0;
    const hasSiteLinks = !!(payload?.organic_results?.[0]?.sitelinks);

    // ── PAA with sub-questions ────────────────────────────────────────────────
    const rawPaa = Array.isArray(payload?.related_questions) ? payload.related_questions : [];
    const paaQuestions = rawPaa.slice(0, 12).map((item: Record<string, unknown>) => ({
      question: String(item.question ?? ''),
      snippet: item.snippet ? String(item.snippet).slice(0, 200) : null,
      link: item.link ? String(item.link) : null,
      source_domain: item.link ? extractDomain(String(item.link)) : null,
    }));

    // ── Organic result analysis ───────────────────────────────────────────────
    const organic = (payload?.organic_results ?? []) as Array<{
      link?: string;
      title?: string;
      snippet?: string;
      position?: number;
    }>;

    const topDomainTypes = [...new Set(
      organic.slice(0, 5).map((r) => classifyDomainType(r.link ?? '')),
    )];

    // Estimate average content length from snippet lengths as a proxy
    const snippetLengths = organic
      .slice(0, 5)
      .map((r) => (r.snippet ?? '').split(/\s+/).filter(Boolean).length)
      .filter((n) => n > 0);
    const avgSnippetWords = snippetLengths.length > 0
      ? Math.round(snippetLengths.reduce((a, b) => a + b, 0) / snippetLengths.length)
      : null;

    // Result count
    const resultCount = String(payload?.search_information?.total_results ?? '').trim() || null;

    const features: SerpFeaturesRow = {
      keyword,
      has_featured_snippet: hasFeaturedSnippet,
      featured_snippet_type: snippetType,
      featured_snippet_url: snippetUrl,
      featured_snippet_domain: snippetDomain,
      featured_snippet_text: snippetText,
      has_knowledge_panel: hasKnowledgePanel,
      has_video_carousel: hasVideoCarousel,
      has_image_pack: hasImagePack,
      has_shopping_results: hasShoppingResults,
      has_news_results: hasNewsResults,
      has_local_pack: hasLocalPack,
      has_site_links: hasSiteLinks,
      paa_questions: paaQuestions,
      paa_count: paaQuestions.length,
      top_domain_types: topDomainTypes,
      avg_serp_word_count: avgSnippetWords ? avgSnippetWords * 8 : null, // rough extrapolation
      result_count: resultCount,
      recommended_format: recommendFormat({
        has_featured_snippet: hasFeaturedSnippet,
        featured_snippet_type: snippetType,
        has_video_carousel: hasVideoCarousel,
        has_shopping_results: hasShoppingResults,
        has_news_results: hasNewsResults,
      }),
      queried_at: new Date().toISOString(),
    };

    return features;
  } catch (err) {
    console.warn(`[serp-features] Error for "${keyword}":`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function run(): Promise<void> {
  if (!SERPAPI_KEY) {
    console.log('[serp-feature-detector] SERPAPI_API_KEY not set — skipping.');
    return;
  }

  const cutoff = new Date(Date.now() - REFRESH_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  // Load draft pages + keyword_queue entries not recently scanned
  const [pagesResult, queueResult] = await Promise.all([
    supabase
      .from('pages')
      .select('slug, primary_keyword')
      .eq('status', 'draft')
      .not('primary_keyword', 'is', null)
      .limit(LIMIT),
    supabase
      .from('keyword_queue')
      .select('keyword, normalized_keyword')
      .in('status', ['new', 'in_progress'])
      .limit(LIMIT),
  ]);

  type KeywordEntry = { keyword: string; page_slug?: string };
  const entries: KeywordEntry[] = [
    ...((pagesResult.data ?? []) as Array<{ slug: string; primary_keyword: string }>).map((p) => ({
      keyword: p.primary_keyword,
      page_slug: p.slug,
    })),
    ...((queueResult.data ?? []) as Array<{ keyword: string }>).map((q) => ({
      keyword: q.keyword,
    })),
  ];

  // Deduplicate by keyword
  const seen = new Set<string>();
  const unique: KeywordEntry[] = [];
  for (const e of entries) {
    const k = e.keyword.toLowerCase().trim();
    if (!seen.has(k)) { seen.add(k); unique.push(e); }
  }

  // Filter: skip recently scanned
  const { data: recentScans } = await supabase
    .from('serp_features')
    .select('keyword')
    .gte('queried_at', cutoff);

  const recentKeywords = new Set((recentScans ?? []).map((r: any) => String(r.keyword).toLowerCase()));
  const toProcess = unique.filter((e) => !recentKeywords.has(e.keyword.toLowerCase())).slice(0, LIMIT);

  if (toProcess.length === 0) {
    console.log('[serp-feature-detector] All keywords have fresh SERP feature data — nothing to do.');
    return;
  }

  console.log(`[serp-feature-detector] Analysing ${toProcess.length} keywords...`);
  let saved = 0;

  for (const entry of toProcess) {
    const features = await fetchSerpFeatures(entry.keyword);
    if (!features) continue;

    if (entry.page_slug) features.page_slug = entry.page_slug;

    const { error } = await supabase.from('serp_features').upsert(features, { onConflict: 'keyword' });
    if (error) {
      console.warn(`[serp-features] DB write failed for "${entry.keyword}": ${error.message}`);
      continue;
    }

    // Update content_gaps row with serp_features summary
    if (entry.page_slug) {
      await supabase
        .from('content_gaps')
        .update({
          serp_features: {
            has_featured_snippet: features.has_featured_snippet,
            featured_snippet_type: features.featured_snippet_type,
            has_video_carousel: features.has_video_carousel,
            has_news_results: features.has_news_results,
            recommended_format: features.recommended_format,
            paa_count: features.paa_count,
          },
        })
        .eq('page_slug', entry.page_slug)
        .eq('keyword', entry.keyword);
    }

    // Update brief with SERP feature hints
    if (entry.page_slug) {
      await supabase
        .from('briefs')
        .update({
          recommended_format: features.recommended_format,
          serp_has_featured_snippet: features.has_featured_snippet,
          serp_featured_snippet_type: features.featured_snippet_type,
        })
        .eq('page_slug', entry.page_slug);
    }

    saved++;
    console.log(
      `[serp-features] "${entry.keyword}": ` +
      `snippet=${features.has_featured_snippet ? features.featured_snippet_type : 'none'}, ` +
      `video=${features.has_video_carousel}, news=${features.has_news_results}, ` +
      `PAA=${features.paa_count}, format→${features.recommended_format}`,
    );
  }

  console.log(`[serp-feature-detector] Done. Saved ${saved} SERP feature records.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
