/**
 * Competitor Content Extractor
 *
 * Fetches and deeply analyses the actual HTML of competitor pages ranking in
 * the top 5 for each of your draft/queued keywords. Extracts:
 *
 *   - Full heading structure (H1–H6) with section word counts
 *   - TF-IDF required entities (terms that MUST appear for topical authority)
 *   - Differentiating entities (what top-3 pages have that position 4-10 don't)
 *   - Schema markup types (FAQPage, HowTo, Review, etc.)
 *   - Content signals (comparison tables, numbered lists, definition boxes)
 *   - Internal/external link counts
 *   - Meta title + description
 *   - Content outline (heading tree with estimated word counts per section)
 *
 * Output: writes to `competitor_page_analyses` table.
 * Consumed by: brief-generator.ts to produce richer content briefs.
 *
 * Usage:
 *   npx tsx scripts/competitor-content-extractor.ts
 *   npx tsx scripts/competitor-content-extractor.ts --dry-run
 *   EXTRACTOR_LIMIT=20 npx tsx scripts/competitor-content-extractor.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';
import {
  computeTfidf,
  extractHeadings,
  extractSchemaTypes,
  extractTextFromHtml,
} from '@/lib/tfidf-extractor';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

// Max number of keywords to process per run
const EXTRACTOR_LIMIT = Number(process.env.EXTRACTOR_LIMIT ?? 30);

// Max age before re-fetching a competitor page analysis (7 days)
const REFRESH_AFTER_DAYS = Number(process.env.EXTRACTOR_REFRESH_DAYS ?? 7);

// Fetch timeout per page
const FETCH_TIMEOUT_MS = 15_000;

// Max competitor pages to fetch per keyword (top N from SERP)
const MAX_PAGES_PER_KEYWORD = 5;

type ContentGapRow = {
  id: string;
  page_slug: string;
  keyword: string;
  serp_snapshot: {
    top_results?: Array<{ link?: string; title?: string; position?: number; snippet?: string }>;
    people_also_ask?: Array<{ question: string }>;
  } | null;
};

type HeadingNode = {
  level: number;
  text: string;
  word_count?: number;
};

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    await rateLimit('fetch');
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RecoveryStackBot/2.0; +https://recoverystack.io/bot)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[extractor] HTTP ${res.status} for ${url}`);
      return null;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) {
      console.warn(`[extractor] Non-HTML content-type for ${url}: ${contentType}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    console.warn(`[extractor] Fetch failed for ${url}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateReadingTimeMin(wordCount: number): number {
  return Math.ceil(wordCount / 200); // average 200 wpm
}

function extractSectionWordCounts(html: string, headings: HeadingNode[]): HeadingNode[] {
  if (headings.length === 0) return headings;

  // Split body text at heading boundaries to estimate section lengths
  const bodyText = html.replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n');
  const sections = bodyText.split(/\n(?=[A-Z])/);

  return headings.map((h, idx) => {
    // Rough word count: text between this heading and next
    const nextHeading = headings[idx + 1];
    const startIdx = bodyText.indexOf(h.text);
    const endIdx = nextHeading ? bodyText.indexOf(nextHeading.text) : bodyText.length;

    if (startIdx >= 0 && endIdx > startIdx) {
      const sectionText = bodyText.slice(startIdx, endIdx);
      return { ...h, word_count: countWords(sectionText) };
    }

    return { ...h, word_count: 0 };
  });
}

function detectContentSignals(html: string): {
  hasComparisonTable: boolean;
  hasNumberedList: boolean;
  hasDefinitionBox: boolean;
  faqCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  imageCount: number;
} {
  const lowerHtml = html.toLowerCase();

  // Comparison table: table with thead + class names common for comparisons
  const hasComparisonTable =
    (/<table\b/i.test(html) && /<th\b/i.test(html)) ||
    /comparison|compare|vs\.|versus/i.test(html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '');

  // Numbered list: significant ol with li items
  const olMatches = html.match(/<ol\b[\s\S]*?<\/ol>/gi) ?? [];
  const hasNumberedList = olMatches.some((ol) => (ol.match(/<li\b/gi) ?? []).length >= 3);

  // Definition box: dl/dt/dd or blockquote or custom callout patterns
  const hasDefinitionBox = /<dl\b/i.test(html) || /<blockquote\b/i.test(html) ||
    /callout|info-box|tip-box|definition|note-box/i.test(html);

  // FAQ count: accordion pattern or FAQ schema or heading pairs
  const faqHeadings = (html.match(/<h[2-4][^>]*>[\s\S]*?\?[\s\S]*?<\/h[2-4]>/gi) ?? []).length;
  const faqSchemaCount = (html.match(/"@type"\s*:\s*"Question"/gi) ?? []).length;
  const faqCount = Math.max(faqHeadings, faqSchemaCount);

  // Link counting
  const allLinks = html.match(/href=["']([^"']+)["']/gi) ?? [];
  let internalLinksCount = 0;
  let externalLinksCount = 0;

  for (const linkMatch of allLinks) {
    const href = linkMatch.replace(/href=["']/i, '').replace(/["']$/, '');
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    if (href.startsWith('/') || href.startsWith('./')) {
      internalLinksCount++;
    } else if (href.startsWith('http')) {
      externalLinksCount++;
    }
  }

  const imageCount = (html.match(/<img\b/gi) ?? []).length;

  return {
    hasComparisonTable,
    hasNumberedList,
    hasDefinitionBox,
    faqCount,
    internalLinksCount,
    externalLinksCount,
    imageCount,
  };
}

function extractMetaTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : null;
}

function extractMetaDescription(html: string): string | null {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return match ? match[1].trim() : null;
}

async function analyseCompetitorPage(
  keyword: string,
  pageSlug: string,
  url: string,
  position: number,
): Promise<{
  html: string;
  analysis: Record<string, unknown>;
} | null> {
  const html = await fetchPageHtml(url);
  if (!html) return null;

  const domain = extractDomain(url);
  const { bodyText } = extractTextFromHtml(html);
  const wordCount = countWords(bodyText);
  const readingTimeMin = estimateReadingTimeMin(wordCount);

  const headings = extractHeadings(html);
  const headingsWithWordCounts = extractSectionWordCounts(html, headings);

  const h1 = headings.find((h) => h.level === 1)?.text ?? null;
  const h2Headings = headings.filter((h) => h.level === 2).map((h) => h.text);
  const h3Headings = headings.filter((h) => h.level === 3).map((h) => h.text);

  const schemaTypes = extractSchemaTypes(html);
  const signals = detectContentSignals(html);
  const metaTitle = extractMetaTitle(html);
  const metaDescription = extractMetaDescription(html);

  // Content outline: structured heading tree with word counts
  const contentOutline = headingsWithWordCounts.map((h) => ({
    level: h.level,
    text: h.text,
    word_count: h.word_count ?? 0,
  }));

  const analysis = {
    keyword,
    page_slug: pageSlug,
    competitor_url: url,
    competitor_domain: domain,
    serp_position: position,
    word_count: wordCount,
    reading_time_min: readingTimeMin,
    h1,
    h2_headings: h2Headings,
    h3_headings: h3Headings,
    heading_count: headings.length,
    schema_types: schemaTypes,
    has_faq_schema: schemaTypes.includes('FAQPage') || schemaTypes.includes('Question'),
    has_how_to_schema: schemaTypes.includes('HowTo'),
    has_review_schema: schemaTypes.includes('Review'),
    has_comparison_table: signals.hasComparisonTable,
    has_numbered_list: signals.hasNumberedList,
    has_definition_box: signals.hasDefinitionBox,
    faq_count: signals.faqCount,
    internal_links_count: signals.internalLinksCount,
    external_links_count: signals.externalLinksCount,
    image_count: signals.imageCount,
    raw_headings: headings,
    content_outline: contentOutline,
    meta_title: metaTitle,
    meta_description: metaDescription,
    fetched_at: new Date().toISOString(),
  };

  return { html, analysis };
}

async function processKeyword(gap: ContentGapRow): Promise<void> {
  const topResults = (gap.serp_snapshot?.top_results ?? [])
    .filter((r) => r.link && !r.link.includes('recoverystack'))
    .slice(0, MAX_PAGES_PER_KEYWORD);

  if (topResults.length === 0) {
    console.log(`[extractor] No competitor URLs for "${gap.keyword}"`);
    return;
  }

  // Check staleness — skip URLs recently analysed
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('competitor_page_analyses')
    .select('competitor_url, fetched_at')
    .eq('keyword', gap.keyword)
    .gte('fetched_at', cutoff);

  const recentlyFetched = new Set((existing ?? []).map((r: any) => r.competitor_url as string));

  const toFetch = topResults.filter((r) => !recentlyFetched.has(r.link ?? ''));
  if (toFetch.length === 0) {
    console.log(`[extractor] All competitor pages for "${gap.keyword}" are fresh — skipping`);
    return;
  }

  // Fetch competitor pages concurrently (max 3 at once)
  const results: Array<{ url: string; position: number; html: string; analysis: Record<string, unknown> }> = [];

  for (let i = 0; i < toFetch.length; i += 3) {
    const batch = toFetch.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(async (r) => {
        const url = r.link!;
        const position = r.position ?? (i + 1);
        const result = await analyseCompetitorPage(gap.keyword, gap.page_slug, url, position);
        if (!result) return null;
        return { url, position, html: result.html, analysis: result.analysis };
      }),
    );
    results.push(...batchResults.filter((r): r is NonNullable<typeof r> => r !== null));
  }

  if (results.length === 0) {
    console.log(`[extractor] Could not fetch any competitor pages for "${gap.keyword}"`);
    return;
  }

  // Run TF-IDF across all fetched pages
  const tfidfInput = results.map((r) => ({
    url: r.url,
    position: r.position,
    html: r.html,
  }));

  const tfidf = computeTfidf(tfidfInput, 3);

  // Enrich each analysis with TF-IDF data
  for (const result of results) {
    const enrichedAnalysis = {
      ...result.analysis,
      required_entities: tfidf.requiredEntities,
      differentiating_entities: tfidf.differentiatingEntities,
      tfidf_top_terms: Object.fromEntries(tfidf.topTerms.map((t) => [t.term, t.score])),
      raw_entities: tfidf.topTerms.map((t) => ({ term: t.term, score: t.score, doc_freq: t.docFreq })),
    };

    if (isDryRun) {
      console.log(`[extractor] DRY RUN — ${result.url}: ${(result.analysis.word_count as number)} words, ` +
        `${(result.analysis.h2_headings as string[]).length} H2s, ` +
        `${tfidf.requiredEntities.length} required entities`);
      continue;
    }

    const { error } = await supabase.from('competitor_page_analyses').upsert(enrichedAnalysis, {
      onConflict: 'keyword,competitor_url',
    });

    if (error) {
      console.warn(`[extractor] DB write failed for ${result.url}: ${error.message}`);
    } else {
      console.log(`[extractor] Saved: "${gap.keyword}" → ${extractDomain(result.url)} ` +
        `(${result.analysis.word_count} words, ${tfidf.requiredEntities.length} required entities)`);
    }
  }

  // Also update the content_gap row's serp_snapshot with TF-IDF enrichment
  if (!isDryRun && gap.id) {
    await supabase
      .from('content_gaps')
      .update({
        missing_entities: tfidf.requiredEntities,
        serp_snapshot: {
          ...gap.serp_snapshot,
          tfidf_required_entities: tfidf.requiredEntities,
          tfidf_differentiating: tfidf.differentiatingEntities,
          tfidf_top_terms: tfidf.topTerms.slice(0, 20).map((t) => t.term),
        },
      })
      .eq('id', gap.id);
  }
}

async function run(): Promise<void> {
  console.log(`[competitor-content-extractor] Starting (${isDryRun ? 'DRY RUN' : 'LIVE'}, limit=${EXTRACTOR_LIMIT})`);

  // Load content_gaps that have SERP data but need competitor analysis
  const { data: gaps, error } = await supabase
    .from('content_gaps')
    .select('id, page_slug, keyword, serp_snapshot')
    .not('serp_snapshot', 'is', null)
    .order('created_at', { ascending: false })
    .limit(EXTRACTOR_LIMIT);

  if (error) throw error;

  const validGaps = ((gaps ?? []) as ContentGapRow[]).filter(
    (g) => g.serp_snapshot?.top_results && g.serp_snapshot.top_results.length > 0,
  );

  if (validGaps.length === 0) {
    console.log('[competitor-content-extractor] No content gaps with SERP data found — run gap-analyzer first.');
    return;
  }

  console.log(`[competitor-content-extractor] Processing ${validGaps.length} keyword(s)...`);

  let processed = 0;
  for (const gap of validGaps) {
    try {
      await processKeyword(gap);
      processed++;
    } catch (err) {
      console.error(`[extractor] Failed for "${gap.keyword}":`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[competitor-content-extractor] Done. Processed ${processed}/${validGaps.length} keywords.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
