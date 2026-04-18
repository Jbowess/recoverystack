/**
 * GSC Opportunity Miner
 *
 * Reads Google Search Console data stored in `page_metrics` and `gsc_query_rows`
 * to surface four types of high-value opportunities:
 *
 *   1. IMPRESSION ORPHANS — queries getting impressions with no matching page.
 *      Action: create a new page targeting this query.
 *
 *   2. POSITION PUSH candidates — pages ranking position 4-10 with >100 impressions.
 *      Action: refresh existing content, not create new page.
 *
 *   3. CTR UNDERPERFORMERS — pages with good position (1-5) but CTR below expected.
 *      Action: optimize title + meta description, not content.
 *
 *   4. KEYWORD CANNIBALIZATION — multiple pages competing for same query.
 *      Action: merge or differentiate content.
 *
 * Writes to:
 *   - `gsc_impression_orphans` table (new keywords to create)
 *   - `keyword_queue` (enqueues high-value new page opportunities)
 *   - `pages` (flags position-push and CTR-fix candidates in metadata)
 *
 * Usage:
 *   npx tsx scripts/gsc-opportunity-miner.ts
 *   npx tsx scripts/gsc-opportunity-miner.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { boostSmartRingPriority, isSmartRingKeyword } from '@/lib/market-focus';
import { toLegacyCompatibleQueueTemplateId } from '@/lib/seo-keywords';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

// Thresholds — tunable via env
const ORPHAN_MIN_IMPRESSIONS = Number(process.env.ORPHAN_MIN_IMPRESSIONS ?? 30);
const POSITION_PUSH_MIN_IMPRESSIONS = Number(process.env.POSITION_PUSH_MIN_IMPRESSIONS ?? 100);
const POSITION_PUSH_MAX_POSITION = Number(process.env.POSITION_PUSH_MAX_POSITION ?? 10);
const POSITION_PUSH_MIN_POSITION = Number(process.env.POSITION_PUSH_MIN_POSITION ?? 4);
const CTR_UNDERPERFORM_MAX_POSITION = Number(process.env.CTR_UNDERPERFORM_MAX_POSITION ?? 5);
const CTR_UNDERPERFORM_THRESHOLD = Number(process.env.CTR_UNDERPERFORM_THRESHOLD ?? 0.03); // <3% CTR when in top 5
const ORPHAN_MIN_PRIORITY = Number(process.env.ORPHAN_MIN_PRIORITY ?? 60);
const GSC_LOOKBACK_DAYS = Number(process.env.GSC_LOOKBACK_DAYS ?? 28);

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

// Template inference from query text
const TEMPLATE_RULES: Array<{ patterns: RegExp[]; template: string }> = [
  { patterns: [/\bvs\b|\bcompare|\balternative/i], template: 'alternatives' },
  { patterns: [/\bprotocol\b|\bschedule\b|\broutine\b|\bplan\b/i], template: 'protocols' },
  { patterns: [/\bhrv\b|\bmetric\b|\btrack\b|\bscore\b|\bmeasure\b/i], template: 'metrics' },
  { patterns: [/\bcost\b|\bprice\b|\bworth\b|\bexpensive\b/i], template: 'costs' },
  { patterns: [/\bcompatib\b|\bworks with\b|\bintegrat\b|\bsync\b/i], template: 'compatibility' },
  { patterns: [/\breview\b|\bworth it\b|\brating\b|\bshould i buy\b/i], template: 'reviews' },
  { patterns: [/\bnews\b|\bannounce\b|\blaunch\b|\bupdate\b|\bnew\b.*\b202\d\b/i], template: 'news' },
  { patterns: [/\bguide\b|\bhow to\b|\bwhat is\b|\bexplain\b|\bbeginner\b/i], template: 'guides' },
];

function inferTemplate(query: string): string {
  for (const rule of TEMPLATE_RULES) {
    if (rule.patterns.some((p) => p.test(query))) return rule.template;
  }
  return 'guides';
}

/**
 * Expected CTR curve by position (industry benchmarks for informational queries).
 * Position 1 ≈ 28%, Position 5 ≈ 7%, Position 10 ≈ 2.5%
 */
function expectedCtr(position: number): number {
  if (position <= 0) return 0;
  const benchmarks: Record<number, number> = { 1: 0.28, 2: 0.16, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.035, 9: 0.03, 10: 0.025 };
  return benchmarks[Math.round(position)] ?? (position > 10 ? 0.01 : 0.025);
}

type GscQueryRow = {
  query: string;
  page?: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
};

type PageRecord = {
  id: string;
  slug: string;
  template: string;
  primary_keyword: string | null;
  metadata: Record<string, unknown> | null;
  clicks?: number;
  impressions?: number;
  avg_position?: number;
  avg_ctr?: number;
};

async function loadGscQueryData(): Promise<GscQueryRow[]> {
  // Try loading from gsc_query_rows table (if it exists from GSC sync)
  // Falls back to page_metrics aggregation if not available
  try {
    const cutoff = new Date(Date.now() - GSC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('gsc_query_rows')
      .select('query, page, impressions, clicks, ctr, position')
      .gte('date', cutoff)
      .order('impressions', { ascending: false })
      .limit(5000);

    if (!error && data && data.length > 0) {
      return data as GscQueryRow[];
    }
  } catch {
    // table may not exist
  }

  // Fallback: page_metrics has per-page aggregates (no query breakdown)
  const { data: metrics } = await supabase
    .from('page_metrics')
    .select('slug, clicks, impressions, avg_position, avg_ctr, primary_keyword')
    .order('impressions', { ascending: false })
    .limit(500);

  return ((metrics ?? []) as any[]).map((m) => ({
    query: m.primary_keyword ?? m.slug,
    page: `${SITE_URL}/${m.slug}`,
    impressions: m.impressions ?? 0,
    clicks: m.clicks ?? 0,
    ctr: m.avg_ctr ?? 0,
    position: m.avg_position ?? 50,
  }));
}

async function loadPublishedPages(): Promise<PageRecord[]> {
  const { data } = await supabase
    .from('pages')
    .select('id, slug, template, primary_keyword, metadata, clicks, impressions, avg_position, avg_ctr')
    .eq('status', 'published');
  return (data ?? []) as PageRecord[];
}

async function run(): Promise<void> {
  console.log(`[gsc-opportunity-miner] Starting (${isDryRun ? 'DRY RUN' : 'LIVE'})...`);

  const [gscRows, publishedPages] = await Promise.all([
    loadGscQueryData(),
    loadPublishedPages(),
  ]);

  if (gscRows.length === 0) {
    console.log('[gsc-opportunity-miner] No GSC query data found — run gsc-sync first, or check gsc_query_rows table.');
    return;
  }

  console.log(`[gsc-opportunity-miner] Analysing ${gscRows.length} query rows against ${publishedPages.length} published pages...`);

  // Build lookup: keyword → page
  const keywordToPage = new Map<string, PageRecord>();
  const slugToPage = new Map<string, PageRecord>();
  for (const page of publishedPages) {
    slugToPage.set(page.slug, page);
    if (page.primary_keyword) {
      keywordToPage.set(page.primary_keyword.toLowerCase().trim(), page);
    }
  }

  // Build lookup: page URL → page
  const urlToPage = new Map<string, PageRecord>();
  for (const page of publishedPages) {
    const url = `${SITE_URL}/${page.template}/${page.slug}`;
    urlToPage.set(url, page);
  }

  const orphans: GscQueryRow[] = [];
  const positionPushCandidates: Array<{ page: PageRecord; query: GscQueryRow }> = [];
  const ctrUnderperformers: Array<{ page: PageRecord; query: GscQueryRow; expectedCtrValue: number }> = [];
  const cannibalizationMap = new Map<string, Array<{ page: PageRecord; query: GscQueryRow }>>();

  for (const row of gscRows) {
    if (!row.query || !row.query.trim()) continue;
    const queryLower = row.query.toLowerCase().trim();

    // Find matching page
    const matchedPage = row.page ? urlToPage.get(row.page) : keywordToPage.get(queryLower);

    if (!matchedPage) {
      // Impression orphan
      if (row.impressions >= ORPHAN_MIN_IMPRESSIONS && isSmartRingKeyword(row.query)) {
        orphans.push(row);
      }
      continue;
    }

    // Position push candidate
    if (
      row.impressions >= POSITION_PUSH_MIN_IMPRESSIONS &&
      row.position >= POSITION_PUSH_MIN_POSITION &&
      row.position <= POSITION_PUSH_MAX_POSITION
    ) {
      positionPushCandidates.push({ page: matchedPage, query: row });
    }

    // CTR underperformer
    if (row.position <= CTR_UNDERPERFORM_MAX_POSITION && row.impressions >= 50) {
      const expected = expectedCtr(row.position);
      if (row.ctr < CTR_UNDERPERFORM_THRESHOLD && row.ctr < expected * 0.6) {
        ctrUnderperformers.push({ page: matchedPage, query: row, expectedCtrValue: expected });
      }
    }

    // Cannibalization tracking: multiple pages for same query
    const existing = cannibalizationMap.get(queryLower) ?? [];
    existing.push({ page: matchedPage, query: row });
    cannibalizationMap.set(queryLower, existing);
  }

  const cannibalizationIssues = Array.from(cannibalizationMap.entries())
    .filter(([, pages]) => pages.length > 1);

  console.log(`[gsc-opportunity-miner] Found:`);
  console.log(`  Impression orphans: ${orphans.length}`);
  console.log(`  Position push candidates: ${positionPushCandidates.length}`);
  console.log(`  CTR underperformers: ${ctrUnderperformers.length}`);
  console.log(`  Cannibalization issues: ${cannibalizationIssues.length}`);

  if (isDryRun) {
    console.log('\n[gsc-opportunity-miner] TOP ORPHANS (would enqueue):');
    orphans.slice(0, 10).forEach((o) =>
      console.log(`  "${o.query}" — ${o.impressions} impr, pos ${o.position.toFixed(1)}`),
    );
    console.log('\n[gsc-opportunity-miner] TOP POSITION PUSH:');
    positionPushCandidates.slice(0, 5).forEach(({ page, query }) =>
      console.log(`  "${query.query}" → ${page.slug} (pos ${query.position.toFixed(1)}, ${query.impressions} impr)`),
    );
    console.log('\n[gsc-opportunity-miner] CTR UNDERPERFORMERS:');
    ctrUnderperformers.slice(0, 5).forEach(({ page, query, expectedCtrValue }) =>
      console.log(`  "${query.query}" → ${page.slug} (CTR ${(query.ctr * 100).toFixed(1)}% vs expected ${(expectedCtrValue * 100).toFixed(1)}%)`),
    );
    return;
  }

  // ── 1. Upsert impression orphans ──────────────────────────────────────────
  let orphansEnqueued = 0;
  for (const orphan of orphans) {
    // Priority score: logarithmic scale from impressions
    const priorityScore = boostSmartRingPriority(
      orphan.query,
      Math.min(100, Math.round(40 + Math.log10(Math.max(1, orphan.impressions)) * 15)),
    );

    const suggestedTemplate = inferTemplate(orphan.query);

    const { error: orphanError } = await supabase.from('gsc_impression_orphans').upsert({
      query: orphan.query,
      impressions: orphan.impressions,
      clicks: orphan.clicks,
      avg_position: orphan.position,
      opportunity_type: 'new_page',
      suggested_template: suggestedTemplate,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'query' });

    if (orphanError) {
      console.warn(`[gsc-opportunity-miner] Orphan write failed: ${orphanError.message}`);
      continue;
    }

    // Enqueue high-value orphans into keyword_queue
    if (priorityScore >= ORPHAN_MIN_PRIORITY) {
      const baseQueueRow = {
        primary_keyword: orphan.query,
        cluster_name: orphan.query.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'smart-ring-opportunities',
        source: 'topical_gap',
        status: 'new',
        priority: priorityScore,
        real_search_volume: orphan.impressions,
        template_id: toLegacyCompatibleQueueTemplateId(suggestedTemplate as any),
        metadata: {
          gsc_impressions: orphan.impressions,
          gsc_clicks: orphan.clicks,
          gsc_position: orphan.position,
          opportunity_type: 'new_page',
          discovered_at: new Date().toISOString(),
          desired_template_id: suggestedTemplate,
        },
      };

      let { error: queueError } = await supabase.from('keyword_queue').upsert({
        ...baseQueueRow,
        normalized_keyword: orphan.query.toLowerCase().trim(),
      }, { onConflict: 'cluster_name,primary_keyword' });

      if (queueError?.message?.includes('normalized_keyword')) {
        ({ error: queueError } = await supabase.from('keyword_queue').upsert(baseQueueRow, {
          onConflict: 'cluster_name,primary_keyword',
        }));
      }

      if (!queueError) orphansEnqueued++;

      // Mark orphan as enqueued
      await supabase
        .from('gsc_impression_orphans')
        .update({ enqueued: true, enqueued_at: new Date().toISOString() })
        .eq('query', orphan.query);
    }
  }

  // ── 2. Flag position push candidates ─────────────────────────────────────
  let positionPushFlagged = 0;
  for (const { page, query } of positionPushCandidates) {
    const { error } = await supabase
      .from('pages')
      .update({
        metadata: {
          ...page.metadata,
          position_push_opportunity: true,
          position_push_query: query.query,
          position_push_position: query.position,
          position_push_impressions: query.impressions,
          position_push_flagged_at: new Date().toISOString(),
        },
      })
      .eq('id', page.id);

    if (!error) positionPushFlagged++;
  }

  // ── 3. Flag CTR underperformers ───────────────────────────────────────────
  let ctrFlagged = 0;
  for (const { page, query, expectedCtrValue } of ctrUnderperformers) {
    const { error } = await supabase
      .from('pages')
      .update({
        metadata: {
          ...page.metadata,
          ctr_underperformer: true,
          ctr_actual: query.ctr,
          ctr_expected: expectedCtrValue,
          ctr_deficit_pct: Math.round((1 - query.ctr / expectedCtrValue) * 100),
          ctr_query: query.query,
          ctr_position: query.position,
          ctr_flagged_at: new Date().toISOString(),
        },
      })
      .eq('id', page.id);

    if (!error) ctrFlagged++;
  }

  // ── 4. Log cannibalization issues ─────────────────────────────────────────
  for (const [query, pages] of cannibalizationIssues) {
    console.warn(
      `[gsc-opportunity-miner] CANNIBALIZATION: "${query}" matched by ${pages.length} pages: ` +
      pages.map((p) => p.page.slug).join(', '),
    );
  }

  console.log(
    `[gsc-opportunity-miner] Done. ` +
    `Orphans found=${orphans.length} enqueued=${orphansEnqueued}, ` +
    `position-push flagged=${positionPushFlagged}, ` +
    `CTR fixes flagged=${ctrFlagged}, ` +
    `cannibalization issues=${cannibalizationIssues.length}`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
