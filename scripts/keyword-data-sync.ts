/**
 * Keyword Volume Data Sync
 *
 * Fetches authoritative search volume, keyword difficulty, CPC, and intent
 * data for all keywords in the pipeline. Supports multiple data sources:
 *
 *   1. DataForSEO API (primary) — full suite: volume, difficulty, CPC, trends
 *   2. Google Keyword Planner API (via OAuth) — fallback volume data
 *   3. Ahrefs API (if key present) — difficulty + parent keyword
 *
 * Writes to `keyword_volume_data` table and updates `keyword_queue` with
 * authoritative volume and difficulty scores.
 *
 * Without authoritative data, the pipeline generates pages for keywords
 * with zero real demand. This script ensures every page targets a keyword
 * with verified search volume before content generation runs.
 *
 * Required env vars (at least one):
 *   DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD
 *   AHREFS_API_KEY
 *
 * Usage:
 *   npx tsx scripts/keyword-data-sync.ts
 *   KEYWORD_SYNC_LIMIT=100 npx tsx scripts/keyword-data-sync.ts
 *   npx tsx scripts/keyword-data-sync.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.KEYWORD_SYNC_LIMIT ?? 100);
// Refresh volume data after 7 days
const REFRESH_AFTER_DAYS = Number(process.env.KEYWORD_VOLUME_REFRESH_DAYS ?? 7);
// Minimum search volume to consider a keyword viable for content generation
const MIN_VIABLE_VOLUME = Number(process.env.MIN_VIABLE_VOLUME ?? 50);

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const AHREFS_API_KEY = process.env.AHREFS_API_KEY;

// Target location/language for AU market (DataForSEO location code)
const DATAFORSEO_LOCATION = Number(process.env.DATAFORSEO_LOCATION ?? 2036); // Australia
const DATAFORSEO_LANGUAGE = process.env.DATAFORSEO_LANGUAGE ?? 'en';

type KeywordVolumeResult = {
  keyword: string;
  search_volume_monthly: number | null;
  search_volume_trend: 'rising' | 'stable' | 'declining' | null;
  cpc_usd: number | null;
  competition: number | null;
  keyword_difficulty: number | null;
  intent: string | null;
  parent_keyword: string | null;
  monthly_searches: Array<{ year: number; month: number; searches: number }>;
  data_source: string;
};

function normalizeKeyword(kw: string): string {
  return kw.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * DataForSEO Keywords Data API
 * Batch endpoint: POST /v3/keywords_data/google_ads/search_volume/live
 */
async function fetchDataForSeo(keywords: string[]): Promise<Map<string, KeywordVolumeResult>> {
  if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) return new Map();

  const results = new Map<string, KeywordVolumeResult>();
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

  // DataForSEO allows up to 1000 keywords per request — batch efficiently
  const BATCH_SIZE = 100;

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    try {
      const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          keywords: batch,
          location_code: DATAFORSEO_LOCATION,
          language_code: DATAFORSEO_LANGUAGE,
          date_from: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7) + '-01',
        }]),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn(`[keyword-data-sync] DataForSEO error ${res.status}`);
        continue;
      }

      const json = await res.json();
      const tasks = json?.tasks ?? [];

      for (const task of tasks) {
        const items = task?.result?.[0]?.items ?? [];
        for (const item of items) {
          const kw = normalizeKeyword(String(item.keyword ?? ''));
          if (!kw) continue;

          const monthlySearches = (item.monthly_searches ?? []).map((m: any) => ({
            year: m.year,
            month: m.month,
            searches: m.search_volume ?? 0,
          }));

          // Trend detection: compare last 3 months vs previous 3 months
          const recent = monthlySearches.slice(-3).reduce((s: number, m: any) => s + m.searches, 0);
          const previous = monthlySearches.slice(-6, -3).reduce((s: number, m: any) => s + m.searches, 0);
          let trend: 'rising' | 'stable' | 'declining' = 'stable';
          if (previous > 0) {
            const change = (recent - previous) / previous;
            if (change > 0.15) trend = 'rising';
            else if (change < -0.15) trend = 'declining';
          }

          results.set(kw, {
            keyword: item.keyword ?? kw,
            search_volume_monthly: item.search_volume ?? null,
            search_volume_trend: trend,
            cpc_usd: item.cpc ? parseFloat(item.cpc) : null,
            competition: item.competition ? parseFloat(item.competition) : null,
            keyword_difficulty: null, // DataForSEO search volume API doesn't include KD
            intent: null,
            parent_keyword: null,
            monthly_searches: monthlySearches,
            data_source: 'dataforseo',
          });
        }
      }

      console.log(`[keyword-data-sync] DataForSEO batch ${Math.ceil(i / BATCH_SIZE) + 1}: ${batch.length} keywords`);

      // Respect DataForSEO rate limits: 2s between batches
      if (i + BATCH_SIZE < keywords.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      console.warn('[keyword-data-sync] DataForSEO batch failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return results;
}

/**
 * DataForSEO SERP API — Keyword Difficulty
 * Separate endpoint: POST /v3/serp/google/organic/live/advanced
 */
async function fetchKeywordDifficulty(keywords: string[]): Promise<Map<string, number>> {
  if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) return new Map();

  const results = new Map<string, number>();
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');

  // Keyword difficulty is expensive — only fetch for high-volume keywords
  const BATCH_SIZE = 10;

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    try {
      const tasks = batch.map((kw) => ({
        keyword: kw,
        location_code: DATAFORSEO_LOCATION,
        language_code: DATAFORSEO_LANGUAGE,
      }));

      const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tasks),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) continue;

      const json = await res.json();
      for (const task of (json?.tasks ?? [])) {
        const kw = normalizeKeyword(String(task?.data?.keyword ?? ''));
        const kd = task?.result?.[0]?.keyword_difficulty;
        if (kw && typeof kd === 'number') results.set(kw, kd);
      }

      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.warn('[keyword-data-sync] KD fetch failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return results;
}

/**
 * Ahrefs Keywords Explorer API v3
 * GET /v3/keywords-explorer/overview
 */
async function fetchAhrefsData(keywords: string[]): Promise<Map<string, Partial<KeywordVolumeResult>>> {
  if (!AHREFS_API_KEY) return new Map();

  const results = new Map<string, Partial<KeywordVolumeResult>>();

  try {
    // Ahrefs API supports up to 100 keywords per call
    for (let i = 0; i < keywords.length; i += 100) {
      const batch = keywords.slice(i, i + 100);

      const url = new URL('https://api.ahrefs.com/v3/keywords-explorer/overview');
      url.searchParams.set('country', 'au');
      url.searchParams.set('select', 'keyword,volume,difficulty,parent_keyword,intent');
      url.searchParams.set('keywords', batch.join(','));

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${AHREFS_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        console.warn(`[keyword-data-sync] Ahrefs error ${res.status}`);
        continue;
      }

      const json = await res.json();
      for (const item of (json?.keywords ?? [])) {
        const kw = normalizeKeyword(String(item.keyword ?? ''));
        if (!kw) continue;
        results.set(kw, {
          search_volume_monthly: item.volume ?? null,
          keyword_difficulty: item.difficulty ?? null,
          parent_keyword: item.parent_keyword ?? null,
          intent: item.intent ?? null,
          data_source: 'ahrefs',
        });
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    console.warn('[keyword-data-sync] Ahrefs fetch failed:', err instanceof Error ? err.message : String(err));
  }

  return results;
}

async function run(): Promise<void> {
  if (!DATAFORSEO_LOGIN && !AHREFS_API_KEY) {
    console.log('[keyword-data-sync] No API credentials found. Set DATAFORSEO_LOGIN+DATAFORSEO_PASSWORD or AHREFS_API_KEY.');
    return;
  }

  console.log(`[keyword-data-sync] Starting (${isDryRun ? 'DRY RUN' : 'LIVE'})...`);

  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Load all keywords from keyword_queue + draft pages that need volume data
  const [queueResult, pagesResult] = await Promise.all([
    supabase
      .from('keyword_queue')
      .select('keyword, normalized_keyword')
      .in('status', ['new', 'in_progress', 'pending'])
      .limit(LIMIT),
    supabase
      .from('pages')
      .select('primary_keyword')
      .eq('status', 'draft')
      .not('primary_keyword', 'is', null)
      .limit(LIMIT),
  ]);

  const allKeywords = new Set<string>();
  for (const row of (queueResult.data ?? [])) allKeywords.add(normalizeKeyword(String(row.keyword)));
  for (const row of (pagesResult.data ?? [])) {
    if (row.primary_keyword) allKeywords.add(normalizeKeyword(String(row.primary_keyword)));
  }

  // Filter: skip recently refreshed
  const { data: recentData } = await supabase
    .from('keyword_volume_data')
    .select('normalized_keyword')
    .gte('refreshed_at', cutoff);

  const recentKeywords = new Set((recentData ?? []).map((r: any) => String(r.normalized_keyword)));
  const toFetch = Array.from(allKeywords).filter((k) => !recentKeywords.has(k)).slice(0, LIMIT);

  if (toFetch.length === 0) {
    console.log('[keyword-data-sync] All keywords have fresh volume data — nothing to do.');
    return;
  }

  console.log(`[keyword-data-sync] Fetching data for ${toFetch.length} keywords...`);

  // Fetch from all available sources
  const [dfsData, ahrefsData] = await Promise.all([
    fetchDataForSeo(toFetch),
    fetchAhrefsData(toFetch),
  ]);

  // Fetch keyword difficulty for high-value keywords
  const highValueKeywords = toFetch.filter((kw) => {
    const dfs = dfsData.get(kw);
    return dfs && (dfs.search_volume_monthly ?? 0) >= MIN_VIABLE_VOLUME;
  });
  const difficultyData = await fetchKeywordDifficulty(highValueKeywords.slice(0, 20));

  // Merge data sources — DataForSEO is primary, Ahrefs fills gaps
  let upserted = 0;
  let markedInviable = 0;

  for (const kw of toFetch) {
    const dfs = dfsData.get(kw);
    const ahrefs = ahrefsData.get(kw);
    const difficulty = difficultyData.get(kw);

    const merged: Record<string, unknown> = {
      keyword: kw,
      normalized_keyword: kw,
      data_source: dfs ? 'dataforseo' : ahrefs ? 'ahrefs' : 'none',
      search_volume_monthly: dfs?.search_volume_monthly ?? ahrefs?.search_volume_monthly ?? null,
      search_volume_trend: dfs?.search_volume_trend ?? null,
      cpc_usd: dfs?.cpc_usd ?? null,
      competition: dfs?.competition ?? null,
      keyword_difficulty: difficulty ?? ahrefs?.keyword_difficulty ?? dfs?.keyword_difficulty ?? null,
      intent: ahrefs?.intent ?? dfs?.intent ?? null,
      parent_keyword: ahrefs?.parent_keyword ?? dfs?.parent_keyword ?? null,
      monthly_searches: dfs?.monthly_searches ?? [],
      country: 'AU',
      refreshed_at: new Date().toISOString(),
    };

    if (isDryRun) {
      console.log(`[keyword-data-sync] DRY RUN — ${kw}: vol=${merged.search_volume_monthly ?? 'n/a'}, kd=${merged.keyword_difficulty ?? 'n/a'}`);
      continue;
    }

    const { error } = await supabase.from('keyword_volume_data').upsert(merged, {
      onConflict: 'normalized_keyword',
    });

    if (error) {
      console.warn(`[keyword-data-sync] DB write failed for "${kw}": ${error.message}`);
      continue;
    }

    // Update keyword_queue with authoritative data
    const volume = merged.search_volume_monthly as number | null;
    await supabase
      .from('keyword_queue')
      .update({
        real_search_volume: volume,
        keyword_difficulty: merged.keyword_difficulty ?? null,
        // Mark inviable keywords to prevent content generation waste
        status: volume !== null && volume < MIN_VIABLE_VOLUME ? 'inviable' : undefined,
      })
      .eq('normalized_keyword', kw)
      .not('status', 'eq', 'published');

    if (volume !== null && volume < MIN_VIABLE_VOLUME) markedInviable++;
    upserted++;
  }

  console.log(
    `[keyword-data-sync] Done. Upserted ${upserted} keyword records. ` +
    `Marked ${markedInviable} as inviable (volume < ${MIN_VIABLE_VOLUME}/mo).`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
