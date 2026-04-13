/**
 * Content Brief Generator
 *
 * Runs between gap-analyzer and content-generator in the pipeline.
 * For each content_gaps row created today:
 *   1. Fetches word counts from top-3 competitor SERP pages
 *   2. Sets target_word_count = max(competitors) * 1.2
 *   3. Extracts required_subtopics from heading_gaps in the SERP snapshot
 *   4. Sets required_paa_answers from people_also_ask questions
 *   5. Identifies competitor weaknesses
 *   6. Pulls search_volume and keyword_difficulty from keyword_queue.metadata
 *   7. Upserts into briefs table
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
  serp_snapshot?: SerpSnapshot;
}

interface KeywordQueueRow {
  real_search_volume?: number | null;
  keyword_difficulty?: number | null;
  metadata?: Record<string, unknown> | null;
}

async function generateBrief(gap: ContentGapRow): Promise<void> {
  const snapshot: SerpSnapshot = gap.serp_snapshot ?? {};
  const topResults: SerpTopResult[] = snapshot.top_results ?? [];
  const paaItems: PaaItem[] = snapshot.people_also_ask ?? [];
  const headingGaps: string[] = snapshot.heading_gaps ?? [];

  // Fetch word counts from top 3 competitor URLs
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

  const maxWordCount = validCounts.length > 0 ? Math.max(...validCounts) : 1200;
  const targetWordCount = Math.round(maxWordCount * 1.2);

  // Required subtopics from heading gaps
  const requiredSubtopics = headingGaps.slice(0, 10);

  // PAA questions as required answers
  const requiredPaaAnswers = paaItems.map((p) => p.question).slice(0, 8);

  // Competitor weaknesses: PAA questions answered by fewer than half competitors
  // Simplified heuristic: any PAA question with no snippet = likely a weakness
  const competitorWeaknesses = paaItems
    .filter((p) => !p.snippet)
    .map((p) => p.question)
    .slice(0, 5);

  // Fetch search volume + difficulty from keyword_queue metadata
  const { data: kqRow } = await supabase
    .from('keyword_queue')
    .select('real_search_volume,keyword_difficulty,metadata')
    .eq('normalized_keyword', gap.keyword.trim().toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .single<KeywordQueueRow>();

  const meta = kqRow?.metadata ?? {};
  const searchVolume =
    typeof kqRow?.real_search_volume === 'number'
      ? kqRow.real_search_volume
      : typeof meta.real_search_volume === 'number'
        ? meta.real_search_volume
        : null;
  const keywordDifficulty =
    typeof kqRow?.keyword_difficulty === 'number'
      ? kqRow.keyword_difficulty
      : typeof meta.keyword_difficulty === 'number'
        ? meta.keyword_difficulty
        : null;

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
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'page_slug' },
  );

  if (error) {
    console.warn(`[brief-generator] Failed to upsert brief for ${gap.page_slug}: ${error.message}`);
    return;
  }

  console.log(
    `[brief-generator] Brief for ${gap.page_slug}: target=${targetWordCount} words, paa=${requiredPaaAnswers.length}, subtopics=${requiredSubtopics.length}`,
  );
}

async function run() {
  // Fetch content_gaps rows created in the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: gaps, error } = await supabase
    .from('content_gaps')
    .select('id, page_slug, keyword, serp_snapshot')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  if (!gaps || gaps.length === 0) {
    console.log('[brief-generator] No new content gaps found — nothing to brief.');
    return;
  }

  console.log(`[brief-generator] Generating briefs for ${gaps.length} gap(s)...`);

  for (const gap of gaps as ContentGapRow[]) {
    await generateBrief(gap);
  }

  console.log('[brief-generator] Brief generation complete.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
