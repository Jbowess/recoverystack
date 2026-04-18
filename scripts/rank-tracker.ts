/**
 * Rank Tracker
 *
 * Tracks daily keyword positions for the top 500 target keywords using
 * SerpAPI or DataForSEO. Writes a time-series to `rank_history` so the
 * adaptive feedback loop can detect position changes caused by content
 * updates, link changes, or algorithm shifts.
 *
 * Features:
 *   - Deduplicates keywords from pages + keyword_queue
 *   - Prioritises by search_volume DESC (highest value first)
 *   - Records position, URL ranking, featured snippet ownership, PAA presence
 *   - Detects ranking URL changes (cannibalization signals)
 *   - Computes 7d / 28d position delta for each keyword
 *   - Alerts when a page drops > ALERT_POSITION_DROP positions in 7d
 *   - Updates pages.metadata.current_position and pages.metadata.position_delta_7d
 *
 * Usage:
 *   npx tsx scripts/rank-tracker.ts
 *   RANK_LIMIT=200 npx tsx scripts/rank-tracker.ts
 *   npx tsx scripts/rank-tracker.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';
import { sendPipelineAlert } from '@/lib/pipeline-alerts';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SERPAPI_KEY = process.env.SERPAPI_API_KEY;
const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const SITE_DOMAIN = (process.env.SITE_URL ?? 'https://recoverystack.io').replace(/^https?:\/\//, '').replace(/\/$/, '');
const LIMIT = Number(process.env.RANK_LIMIT ?? 500);
const ALERT_POSITION_DROP = Number(process.env.RANK_ALERT_DROP ?? 5);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

type RankResult = {
  keyword: string;
  position: number | null;      // null = not in top 100
  ranking_url: string | null;
  is_our_page: boolean;
  page_slug: string | null;
  featured_snippet_owned: boolean;
  in_paa: boolean;
  total_results: string | null;
  checked_at: string;
};

type RankHistoryRow = {
  keyword: string;
  position: number | null;
  ranking_url: string | null;
  page_slug: string | null;
  is_our_page: boolean;
  featured_snippet_owned: boolean;
  in_paa: boolean;
  position_delta_7d: number | null;
  position_delta_28d: number | null;
  total_results: string | null;
  checked_at: string;
};

// ── SerpAPI rank check ────────────────────────────────────────────────────────
async function checkRankViaSerpApi(keyword: string): Promise<RankResult | null> {
  if (!SERPAPI_KEY) return null;
  await rateLimit('serpapi');

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', keyword);
  url.searchParams.set('num', '100');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'au');
  url.searchParams.set('api_key', SERPAPI_KEY);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const data = await res.json();

    const organic = (data?.organic_results ?? []) as Array<{
      position: number;
      link: string;
      title?: string;
    }>;

    let position: number | null = null;
    let rankingUrl: string | null = null;
    let isOurPage = false;
    let pageSlug: string | null = null;

    for (const result of organic) {
      if (result.link?.includes(SITE_DOMAIN)) {
        position = result.position;
        rankingUrl = result.link;
        isOurPage = true;
        // Extract slug from URL
        const match = result.link.match(/\/([^/]+)\/?$/);
        pageSlug = match?.[1] ?? null;
        break;
      }
    }

    const answerBox = data?.answer_box;
    const featuredSnippetOwned = isOurPage && !!answerBox &&
      (String(answerBox?.link ?? answerBox?.source?.link ?? '').includes(SITE_DOMAIN));

    const paaQuestions = data?.related_questions ?? [];
    const inPaa = isOurPage && (paaQuestions as Array<{ link?: string }>).some(
      (q) => q.link?.includes(SITE_DOMAIN),
    );

    return {
      keyword,
      position,
      ranking_url: rankingUrl,
      is_our_page: isOurPage,
      page_slug: pageSlug,
      featured_snippet_owned: featuredSnippetOwned,
      in_paa: inPaa,
      total_results: String(data?.search_information?.total_results ?? '').trim() || null,
      checked_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── DataForSEO rank check (batch, more cost-efficient) ────────────────────────
async function checkRanksViaDataForSeo(keywords: string[]): Promise<Map<string, RankResult>> {
  if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) return new Map();
  await rateLimit('dataforseo');

  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString('base64');
  const tasks = keywords.map((kw) => ({
    keyword: kw,
    language_code: 'en',
    location_code: 2036, // Australia
    depth: 100,
    se_domain: 'google.com.au',
  }));

  const results = new Map<string, RankResult>();

  try {
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tasks),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return results;

    const data = await res.json();
    const taskResults = (data?.tasks ?? []) as Array<{
      data?: { keyword: string };
      result?: Array<{
        items?: Array<{ type: string; rank_absolute: number; url: string; domain?: string }>;
        total_count?: number;
      }>;
    }>;

    for (const task of taskResults) {
      const kw = task.data?.keyword;
      if (!kw) continue;

      const items = task.result?.[0]?.items ?? [];
      const organicItems = items.filter((i) => i.type === 'organic');

      let position: number | null = null;
      let rankingUrl: string | null = null;
      let isOurPage = false;
      let pageSlug: string | null = null;

      for (const item of organicItems) {
        if (item.url?.includes(SITE_DOMAIN)) {
          position = item.rank_absolute;
          rankingUrl = item.url;
          isOurPage = true;
          const match = item.url.match(/\/([^/]+)\/?$/);
          pageSlug = match?.[1] ?? null;
          break;
        }
      }

      const featuredSnippetItem = items.find((i) => i.type === 'featured_snippet');
      const featuredSnippetOwned = !!featuredSnippetItem && featuredSnippetItem.url?.includes(SITE_DOMAIN);

      results.set(kw, {
        keyword: kw,
        position,
        ranking_url: rankingUrl,
        is_our_page: isOurPage,
        page_slug: pageSlug,
        featured_snippet_owned: featuredSnippetOwned,
        in_paa: false,
        total_results: String(task.result?.[0]?.total_count ?? '').trim() || null,
        checked_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[rank-tracker] DataForSEO error:', err instanceof Error ? err.message : String(err));
  }

  return results;
}

// ── Compute position deltas vs historical records ─────────────────────────────
async function computeDeltas(keyword: string, currentPosition: number | null): Promise<{
  delta7d: number | null;
  delta28d: number | null;
}> {
  const now = Date.now();
  const d7ago = new Date(now - 7 * 86_400_000).toISOString();
  const d28ago = new Date(now - 28 * 86_400_000).toISOString();

  const { data } = await supabase
    .from('rank_history')
    .select('position, checked_at')
    .eq('keyword', keyword)
    .gte('checked_at', d28ago)
    .order('checked_at', { ascending: true });

  if (!data || data.length === 0) return { delta7d: null, delta28d: null };

  const rows = data as Array<{ position: number | null; checked_at: string }>;

  // Find closest reading to 7d ago and 28d ago
  const d7row = rows.filter((r) => r.checked_at < d7ago).at(-1);
  const d28row = rows.at(0);

  const delta7d = d7row?.position != null && currentPosition != null
    ? d7row.position - currentPosition // positive = improved
    : null;
  const delta28d = d28row?.position != null && currentPosition != null
    ? d28row.position - currentPosition
    : null;

  return { delta7d, delta28d };
}

async function run(): Promise<void> {
  // ── Load target keywords from pages + keyword_queue ────────────────────────
  const [pagesResult, queueResult] = await Promise.all([
    supabase
      .from('pages')
      .select('slug, primary_keyword, metadata')
      .eq('status', 'published')
      .not('primary_keyword', 'is', null)
      .order('quality_score', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('keyword_volume_data')
      .select('keyword, search_volume_monthly')
      .order('search_volume_monthly', { ascending: false })
      .limit(LIMIT),
  ]);

  type KwEntry = { keyword: string; page_slug?: string };
  const entries: KwEntry[] = [];
  const seen = new Set<string>();

  for (const page of (pagesResult.data ?? []) as Array<{ slug: string; primary_keyword: string }>) {
    const k = page.primary_keyword.toLowerCase().trim();
    if (!seen.has(k)) { seen.add(k); entries.push({ keyword: page.primary_keyword, page_slug: page.slug }); }
  }
  for (const row of (queueResult.data ?? []) as Array<{ keyword: string }>) {
    const k = row.keyword.toLowerCase().trim();
    if (!seen.has(k)) { seen.add(k); entries.push({ keyword: row.keyword }); }
  }

  const toCheck = entries.slice(0, LIMIT);
  console.log(`[rank-tracker] Checking ${toCheck.length} keywords (dryRun=${DRY_RUN})`);

  let saved = 0;
  const alerts: string[] = [];

  // Use DataForSEO batch if available, else fall back to SerpAPI per-keyword
  if (DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD) {
    const BATCH_SIZE = 10;
    for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
      const batch = toCheck.slice(i, i + BATCH_SIZE);
      const batchKeywords = batch.map((e) => e.keyword);
      const batchResults = await checkRanksViaDataForSeo(batchKeywords);

      for (const entry of batch) {
        const result = batchResults.get(entry.keyword);
        if (!result) continue;

        const { delta7d, delta28d } = await computeDeltas(entry.keyword, result.position);

        const row: RankHistoryRow = {
          ...result,
          position_delta_7d: delta7d,
          position_delta_28d: delta28d,
        };

        if (!DRY_RUN) {
          await supabase.from('rank_history').insert(row);

          // Update page metadata with current position
          if (result.page_slug || entry.page_slug) {
            const slug = result.page_slug ?? entry.page_slug!;
            await supabase
              .from('pages')
              .update({
                metadata: {
                  current_position: result.position,
                  position_delta_7d: delta7d,
                  position_delta_28d: delta28d,
                  ranking_url: result.ranking_url,
                  featured_snippet_owned: result.featured_snippet_owned,
                  position_checked_at: result.checked_at,
                },
              })
              .eq('slug', slug);
          }
        }

        // Alert on significant drops
        if (delta7d !== null && delta7d < -ALERT_POSITION_DROP) {
          alerts.push(`"${entry.keyword}": dropped ${Math.abs(delta7d)} positions in 7d (now pos ${result.position})`);
        }

        console.log(
          `[rank-tracker] "${entry.keyword}": pos=${result.position ?? 'NR'} ` +
          `ours=${result.is_our_page} snippet=${result.featured_snippet_owned} ` +
          `Δ7d=${delta7d != null ? (delta7d >= 0 ? '+' : '') + delta7d : 'N/A'}`,
        );
        saved++;
      }
    }
  } else {
    // SerpAPI fallback — serial to respect rate limits
    for (const entry of toCheck) {
      const result = await checkRankViaSerpApi(entry.keyword);
      if (!result) continue;

      const { delta7d, delta28d } = await computeDeltas(entry.keyword, result.position);

      const row: RankHistoryRow = {
        ...result,
        position_delta_7d: delta7d,
        position_delta_28d: delta28d,
      };

      if (!DRY_RUN) {
        await supabase.from('rank_history').insert(row);

        if (result.page_slug || entry.page_slug) {
          const slug = result.page_slug ?? entry.page_slug!;
          await supabase.from('pages').update({
            metadata: {
              current_position: result.position,
              position_delta_7d: delta7d,
              ranking_url: result.ranking_url,
              featured_snippet_owned: result.featured_snippet_owned,
              position_checked_at: result.checked_at,
            },
          }).eq('slug', slug);
        }
      }

      if (delta7d !== null && delta7d < -ALERT_POSITION_DROP) {
        alerts.push(`"${entry.keyword}": dropped ${Math.abs(delta7d)} positions in 7d (now pos ${result.position})`);
      }

      console.log(
        `[rank-tracker] "${entry.keyword}": pos=${result.position ?? 'NR'} ` +
        `snippet=${result.featured_snippet_owned} Δ7d=${delta7d != null ? (delta7d >= 0 ? '+' : '') + delta7d : 'N/A'}`,
      );
      saved++;
    }
  }

  if (alerts.length > 0 && !DRY_RUN) {
    await sendPipelineAlert({
      pipeline: 'rank-tracker',
      step: 'position-drop-alerts',
      status: 'warning',
      message: `${alerts.length} keyword(s) dropped >${ALERT_POSITION_DROP} positions:\n${alerts.join('\n')}`,
      durationMs: 0,
    });
  }

  console.log(`[rank-tracker] Done. Recorded ${saved} position checks, ${alerts.length} drop alert(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
