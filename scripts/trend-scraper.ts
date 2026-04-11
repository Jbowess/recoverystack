import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const REDDIT_FEEDS = [
  { subreddit: 'Biohackers', url: 'https://www.reddit.com/r/Biohackers/.rss' },
  { subreddit: 'running', url: 'https://www.reddit.com/r/running/.rss' },
  { subreddit: 'Fitness', url: 'https://www.reddit.com/r/Fitness/.rss' },
] as const;

const GOOGLE_TRENDS_RSS = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(
  process.env.GOOGLE_TRENDS_GEO ?? 'US',
)}`;

type TrendSeed = {
  term: string;
  source: 'reddit' | 'gtrends';
  score: number;
  competition: 'low' | 'med' | 'high';
  status: 'new';
};

function scoreToCompetition(score: number): 'low' | 'med' | 'high' {
  if (score >= 76) return 'high';
  if (score >= 45) return 'med';
  return 'low';
}

/**
 * Minimal XML item parser to keep dependencies light.
 * Splits by <item>...</item> and then extracts tags using regex.
 */
function extractItems(xml: string): string[] {
  const matches = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  return matches ?? [];
}

function extractTag(itemXml: string, tag: string): string | null {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

/**
 * Normalize noisy post/query text into a reusable trend term:
 * - lowercase
 * - remove punctuation and common filler words
 * - collapse whitespace
 * - cap to max 80 chars to stay DB/UI friendly
 */
function normalizeTerm(raw: string): string {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'for',
    'to',
    'of',
    'in',
    'on',
    'with',
    'is',
    'are',
    'be',
    'how',
    'what',
    'why',
    'when',
    'from',
    'my',
    'your',
  ]);

  const cleaned = decodeEntities(stripHtml(raw))
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = cleaned
    .split(' ')
    .filter(Boolean)
    .filter((t) => !stopWords.has(t));

  // Keep first meaningful phrase chunk; avoid empty terms.
  const term = tokens.slice(0, 8).join(' ').trim();
  return term.length > 80 ? term.slice(0, 80).trim() : term;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(1, Math.min(100, Math.round(score)));
}

function heuristicScoreFromLength(base: number, term: string): number {
  // Short, concrete terms tend to be better trend seeds than long sentence-like ones.
  const tokenCount = term.split(/\s+/).filter(Boolean).length;
  const lengthPenalty = Math.max(0, tokenCount - 6) * 5;
  return clampScore(base - lengthPenalty);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'recoverystack-trend-scraper/1.0 (+rss ingestion)',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }

  return res.text();
}

async function ingestReddit(): Promise<TrendSeed[]> {
  const rows: TrendSeed[] = [];

  for (const feed of REDDIT_FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = extractItems(xml);

      for (const item of items) {
        const title = extractTag(item, 'title');
        if (!title) continue;

        const term = normalizeTerm(title);
        if (!term || term.length < 4) continue;

        // Reddit RSS does not reliably expose vote counts.
        // Score heuristic: subreddit baseline + title quality.
        const subredditBoost =
          feed.subreddit.toLowerCase() === 'biohackers' ? 6 : feed.subreddit.toLowerCase() === 'fitness' ? 4 : 3;
        const score = heuristicScoreFromLength(58 + subredditBoost, term);

        rows.push({
          term,
          source: 'reddit',
          score,
          competition: scoreToCompetition(score),
          status: 'new',
        });
      }

      console.log(`[reddit] ${feed.subreddit}: parsed ${items.length} items`);
    } catch (error) {
      console.error(`[reddit] ${feed.subreddit}: ingestion error`, error);
    }
  }

  return rows;
}

function parseTrafficToScore(approxTraffic: string | null): number {
  if (!approxTraffic) return 62;

  // Examples: "20,000+", "200K+", "1M+"
  const normalized = approxTraffic.replace(/,/g, '').toUpperCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([KM])?/);
  if (!match) return 62;

  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return 62;

  const multiplier = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1;
  const traffic = raw * multiplier;

  // Log scale into a 45-100 band.
  const score = 45 + Math.log10(Math.max(1, traffic)) * 9;
  return clampScore(score);
}

async function ingestGoogleTrends(): Promise<TrendSeed[]> {
  const rows: TrendSeed[] = [];

  try {
    const xml = await fetchText(GOOGLE_TRENDS_RSS);
    const items = extractItems(xml);

    for (const item of items) {
      const title = extractTag(item, 'title');
      if (!title) continue;

      const approxTraffic = extractTag(item, 'ht:approx_traffic') ?? extractTag(item, 'approx_traffic');
      const term = normalizeTerm(title);
      if (!term || term.length < 2) continue;

      const base = parseTrafficToScore(approxTraffic);
      const score = heuristicScoreFromLength(base, term);

      rows.push({
        term,
        source: 'gtrends',
        score,
        competition: scoreToCompetition(score),
        status: 'new',
      });
    }

    console.log(`[gtrends] parsed ${items.length} items from ${GOOGLE_TRENDS_RSS}`);
  } catch (error) {
    console.error('[gtrends] ingestion error', error);
  }

  return rows;
}

async function upsertTrends(rows: TrendSeed[]): Promise<number> {
  if (!rows.length) return 0;

  // Deduplicate by term+source before write to reduce DB churn.
  const deduped = new Map<string, TrendSeed>();
  for (const row of rows) {
    deduped.set(`${row.source}:${row.term}`, row);
  }

  const payload = Array.from(deduped.values());

  const { error } = await supabase.from('trends').upsert(payload, {
    onConflict: 'term',
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  return payload.length;
}

async function run() {
  const [redditRows, googleRows] = await Promise.all([ingestReddit(), ingestGoogleTrends()]);
  const allRows = [...redditRows, ...googleRows];

  if (!allRows.length) {
    console.warn('No trend rows collected from feeds. Exiting without DB writes.');
    return;
  }

  const written = await upsertTrends(allRows);
  console.log(`Trend ingestion complete. Upserted ${written} normalized trend rows.`);
}

run().catch((error) => {
  console.error('Trend ingestion failed:', error);
  process.exit(1);
});
