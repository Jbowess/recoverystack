/**
 * Competitor Content Intelligence
 *
 * Uses SerpAPI to find competitor pages ranking for keywords in your niche.
 * Identifies gaps — keywords competitors rank for that you don't have coverage for.
 * Auto-enqueues high-value steal opportunities into keyword_queue.
 *
 * Configure via COMPETITOR_DOMAINS env var (comma-separated):
 *   COMPETITOR_DOMAINS=ouraring.com,whoop.com,eightsleep.com
 *
 * Run: npm run competitor:spy
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
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

// Keywords to check competitors against.
// Priority is deliberately narrow: recovery/performance wearables first.
const NICHE_SEED_QUERIES = [
  'best recovery wearable',
  'best smart ring for recovery',
  'best recovery tracker',
  'sleep tracking ring',
  'hrv wearable for athletes',
  'readiness score wearable',
  'recovery score wearable',
  'wearable recovery tracker',
  'fitness wearable for recovery',
  'athlete recovery wearable',
  'whoop alternative',
  'oura ring alternative',
  'whoop vs oura',
  'oura ring vs whoop',
  'oura vs ultrahuman ring',
  'garmin body battery alternative',
  'best ring for sleep tracking',
  'best wearable for hrv tracking',
  'wearable subscription comparison',
  'smart ring without subscription',
  'resting heart rate wearable',
  'strain score wearable',
];

const COMPETITOR_POSITION_THRESHOLD = 5; // Only steal from top-5 competitors
const MIN_STEAL_PRIORITY = 70;

interface OrganicResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  domain?: string;
}

async function fetchSerpResults(query: string): Promise<OrganicResult[]> {
  if (!SERPAPI_KEY) return [];

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'au');
  url.searchParams.set('api_key', SERPAPI_KEY);

  await rateLimit('serpapi');
  const res = await fetch(url.toString());
  if (!res.ok) return [];

  const json = await res.json();
  const organic = (json?.organic_results ?? []) as OrganicResult[];

  return organic.slice(0, 10).map((r) => ({
    position: r.position,
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    domain: r.link ? (() => { try { return new URL(r.link!).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '',
  }));
}

function extractKeywordFromTitle(title: string): string {
  // Strip common prefixes/suffixes that don't matter for keyword targeting
  return title
    .replace(/\s*[-|]\s*[A-Z][a-zA-Z\s]+$/, '') // Strip " - Brand Name" suffix
    .replace(/^\d+\.\s+/, '') // Strip numbered list prefix
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .toLowerCase();
}

interface StealOpportunity {
  keyword: string;
  competitorUrl: string;
  competitorDomain: string;
  competitorPosition: number;
  competitorTitle: string;
  template: string;
  priority: number;
}

function inferTemplate(title: string, snippet: string): string {
  const text = `${title} ${snippet}`.toLowerCase();
  if (/\bvs\b|\bcompar|\balternative/.test(text)) return 'alternatives';
  if (/\bprotocol|\bschedule|\broutine|\bplan/.test(text)) return 'protocols';
  if (/\bhrv|\bscore|\bmetric|\btrack/.test(text)) return 'metrics';
  if (/\bcost|\bprice|\bworth|\bexpensive/.test(text)) return 'costs';
  if (/\bcompat|\bintegrat|\bworks with/.test(text)) return 'compatibility';
  if (/\btrend|\b2025|\b2026|\blatest/.test(text)) return 'trends';
  return 'guides';
}

async function run() {
  if (!SERPAPI_KEY) {
    console.log('[competitor-spy] SERPAPI_API_KEY not set — skipping.');
    return;
  }

  const competitorDomains = (process.env.COMPETITOR_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().replace(/^www\./, ''))
    .filter(Boolean);

  if (competitorDomains.length === 0) {
    console.log('[competitor-spy] COMPETITOR_DOMAINS not configured. Set COMPETITOR_DOMAINS=ouraring.com,whoop.com to enable.');
    return;
  }

  console.log(`[competitor-spy] Monitoring ${competitorDomains.length} competitor domain(s): ${competitorDomains.join(', ')}`);

  // Load existing pages + queue to avoid duplicates
  const [pagesResult, queueResult] = await Promise.all([
    supabase.from('pages').select('primary_keyword, slug').eq('status', 'published'),
    supabase.from('keyword_queue').select('keyword'),
  ]);

  const existingKeywords = new Set<string>([
    ...((pagesResult.data ?? []) as Array<{ primary_keyword: string | null }>)
      .map((p) => (p.primary_keyword ?? '').toLowerCase().trim()),
    ...((queueResult.data ?? []) as Array<{ keyword: string }>)
      .map((k) => k.keyword.toLowerCase().trim()),
  ]);

  const ourDomain = SITE_URL.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  const opportunities: StealOpportunity[] = [];
  const competitorRankCount = new Map<string, number>();

  for (const query of NICHE_SEED_QUERIES) {
    console.log(`  Checking: "${query}"...`);
    const results = await fetchSerpResults(query);

    // Check if we already rank for this query
    const weRank = results.some((r) => r.domain?.includes(ourDomain));
    if (weRank) {
      console.log(`    → We already rank for "${query}" — skipping`);
      continue;
    }

    // Find competitor results in top positions
    for (const result of results) {
      const domain = result.domain ?? '';
      const isCompetitor = competitorDomains.some((c) => domain.includes(c));
      if (!isCompetitor) continue;
      if ((result.position ?? 99) > COMPETITOR_POSITION_THRESHOLD) continue;

      const keyword = extractKeywordFromTitle(result.title ?? query);
      const normalized = keyword.toLowerCase();

      if (existingKeywords.has(normalized)) continue;
      if (keyword.length < 10 || keyword.length > 100) continue;

      competitorRankCount.set(domain, (competitorRankCount.get(domain) ?? 0) + 1);

      const template = inferTemplate(result.title ?? '', result.snippet ?? '');
      const priority = Math.round(MIN_STEAL_PRIORITY + (COMPETITOR_POSITION_THRESHOLD - (result.position ?? 5)) * 5);

      opportunities.push({
        keyword,
        competitorUrl: result.link ?? '',
        competitorDomain: domain,
        competitorPosition: result.position ?? 5,
        competitorTitle: result.title ?? '',
        template,
        priority: Math.min(priority, 95),
      });
    }
  }

  console.log(`\n[competitor-spy] Found ${opportunities.length} steal opportunities:`);

  // Deduplicate by keyword
  const seen = new Set<string>(existingKeywords);
  const unique = opportunities.filter((o) => {
    const k = o.keyword.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Show competitor ranking summary
  if (competitorRankCount.size > 0) {
    console.log('\n  Competitor ranking counts in your niche:');
    for (const [domain, count] of [...competitorRankCount.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${domain}: ${count} top-${COMPETITOR_POSITION_THRESHOLD} rankings`);
    }
  }

  if (unique.length === 0) {
    console.log('[competitor-spy] No new steal opportunities to enqueue.');
    return;
  }

  // Show top opportunities
  console.log('\n  Top opportunities:');
  unique.slice(0, 10).forEach((o, i) => {
    console.log(`  ${i + 1}. "${o.keyword}" — ${o.competitorDomain} at #${o.competitorPosition}`);
  });

  // Upsert into keyword_queue
  const toInsert = unique.map((o) => ({
    keyword: o.keyword,
    template: o.template,
    source: 'competitor_steal',
    priority: o.priority,
    status: 'pending',
    score: o.priority / 100,
    cluster_name: 'competitor-steal',
    metadata: {
      competitor_domain: o.competitorDomain,
      competitor_url: o.competitorUrl,
      competitor_position: o.competitorPosition,
      competitor_title: o.competitorTitle,
      steal_opportunity: true,
    },
  }));

  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('keyword_queue')
      .upsert(chunk, { onConflict: 'keyword' });

    if (error) console.warn(`[competitor-spy] Chunk error: ${error.message}`);
    else inserted += chunk.length;
  }

  console.log(`\n[competitor-spy] Enqueued ${inserted} competitor steal keyword(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
