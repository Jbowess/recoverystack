import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { normalizeKeyword } from '@/lib/seo-keywords';
import { assessTrendRelevance } from '@/lib/trend-relevance';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ── Domain relevance filter ──────────────────────────────────────────────────
// Terms that signal the topic is in our domain (recovery/sleep/fitness/health-tech).
// A term must match at least one allowlist token OR score above RELEVANCE_FLOOR
// based on partial matches.
const DOMAIN_ALLOWLIST_TOKENS = new Set([
  // Recovery & performance
  'recovery', 'recover', 'recuperat', 'rest', 'restoration',
  // Sleep
  'sleep', 'hrv', 'rem', 'circadian', 'insomnia', 'melatonin', 'nap', 'snore', 'apnea',
  // Fitness & training
  'workout', 'training', 'exercise', 'fitness', 'strength', 'cardio', 'endurance',
  'hiit', 'crossfit', 'zone 2', 'vo2', 'lactate', 'overtraining', 'deload',
  // Health metrics
  'heart rate', 'heart-rate', 'resting hr', 'rhr', 'spo2', 'oxygen', 'cortisol',
  'inflammation', 'glucose', 'blood pressure', 'cholesterol', 'body composition',
  'muscle', 'tendon', 'ligament', 'fascia',
  // Nutrition & supplementation
  'protein', 'creatine', 'magnesium', 'zinc', 'vitamin d', 'omega', 'collagen',
  'electrolyte', 'hydration', 'nutrition', 'diet', 'supplement', 'caffeine', 'nootropic',
  // Wearables & health-tech
  'ring', 'wearable', 'smart ring', 'whoop', 'oura', 'garmin', 'polar', 'biosensor',
  'continuous glucose', 'cgm', 'biometric', 'health tracker', 'fitness tracker',
  // Wellness & biohacking
  'biohack', 'longevity', 'cold plunge', 'ice bath', 'sauna', 'breathwork',
  'meditation', 'mindfulness', 'stress', 'cortisol', 'adaptogen', 'ashwagandha',
  'inflammation', 'fasting', 'intermittent', 'ketone', 'ketosis',
  // Injury & therapy
  'injury', 'rehab', 'physical therapy', 'mobility', 'flexibility', 'stretching',
  'foam rolling', 'massage', 'percussive', 'cryotherapy', 'compression',
]);

// Terms that hard-block a trend from entering the pipeline regardless of score.
// Covers celebrity/news/entertainment content that bleeds into fitness subreddits.
const DOMAIN_BLOCKLIST_TOKENS = [
  // Emergency/alert systems
  'amber alert', 'silver alert', 'amber', 'missing child', 'missing person', 'evacuation',
  // Celebrity & entertainment
  'celebrity', 'kardashian', 'jenner', 'bieber', 'swift', 'kanye', 'beyonce', 'rihanna',
  'drake', 'nba', 'nfl', 'mlb', 'nhl', 'esport', 'e-sport', 'twitch', 'streaming',
  // Politics & news
  'election', 'president', 'congress', 'senate', 'legislation', 'bill passes',
  'stock market', 'crypto', 'bitcoin', 'nft', 'dogecoin', 'ethereum',
  // Sports player names / team events (generic blockers — not domain specific)
  'traded to', 'signs with', 'released by', 'game 7', 'super bowl',
];

/**
 * Returns true if the term is relevant to our domain (recovery/fitness/health-tech).
 * Checks:
 *  1. Hard blocklist — any match → reject immediately
 *  2. Allowlist — any token substring match → accept
 *  3. Falls back to false (unknown / off-topic)
 */
function isDomainRelevant(term: string): boolean {
  const lower = term.toLowerCase();

  // Step 1: blocklist check
  for (const blocked of DOMAIN_BLOCKLIST_TOKENS) {
    if (lower.includes(blocked)) return false;
  }

  // Step 2: allowlist check (substring match for token stems)
  for (const token of DOMAIN_ALLOWLIST_TOKENS) {
    if (lower.includes(token)) return true;
  }

  return false;
}
// ─────────────────────────────────────────────────────────────────────────────

const REDDIT_FEEDS = [
  { subreddit: 'Biohackers', url: 'https://www.reddit.com/r/Biohackers/.rss' },
  { subreddit: 'running', url: 'https://www.reddit.com/r/running/.rss' },
  { subreddit: 'Fitness', url: 'https://www.reddit.com/r/Fitness/.rss' },
  { subreddit: 'swimming', url: 'https://www.reddit.com/r/swimming/.rss' },
  { subreddit: 'triathlon', url: 'https://www.reddit.com/r/triathlon/.rss' },
  { subreddit: 'weightlifting', url: 'https://www.reddit.com/r/weightlifting/.rss' },
  { subreddit: 'wearables', url: 'https://www.reddit.com/r/wearables/.rss' },
  { subreddit: 'Supplements', url: 'https://www.reddit.com/r/Supplements/.rss' },
] as const;

// Industry publication RSS feeds — domain-filtered for fitness/recovery/health-tech news
const INDUSTRY_RSS_FEEDS = [
  { publication: 'Wareable', url: 'https://www.wareable.com/rss' },
  { publication: 'Gear Patrol Health', url: 'https://gearpatrol.com/feed/' },
  { publication: 'Ars Technica Tech', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { publication: 'Men\'s Health Fitness', url: 'https://www.menshealth.com/rss/all.xml/' },
  { publication: 'Outside Online', url: 'https://www.outsideonline.com/feed/' },
] as const;

const GOOGLE_TRENDS_RSS = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(
  process.env.GOOGLE_TRENDS_GEO ?? 'US',
)}`;

type TrendSeed = {
  term: string;
  source: 'reddit' | 'gtrends' | 'industry_rss' | 'news_api' | 'youtube_search' | 'youtube_channel';
  normalizedTerm: string;
  score: number;
  competition: 'low' | 'med' | 'high';
  status: 'new';
  observedAt: string;
  approxTraffic?: string | null;
  sourceItemId?: string | null;
  payload: Record<string, unknown>;
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
          normalizedTerm: normalizeKeyword(term),
          score,
          competition: scoreToCompetition(score),
          status: 'new',
          observedAt: new Date().toISOString(),
          sourceItemId: extractTag(item, 'guid'),
          payload: {
            subreddit: feed.subreddit,
            title,
            guid: extractTag(item, 'guid'),
            published_at: extractTag(item, 'pubDate'),
          },
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

async function ingestIndustryRss(): Promise<TrendSeed[]> {
  const rows: TrendSeed[] = [];

  for (const feed of INDUSTRY_RSS_FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = extractItems(xml);

      for (const item of items) {
        const title = extractTag(item, 'title');
        if (!title) continue;

        const term = normalizeTerm(title);
        if (!term || term.length < 4) continue;

        // Industry publications score slightly higher than Reddit (editorial signal)
        const score = heuristicScoreFromLength(65, term);

        rows.push({
          term,
          source: 'industry_rss',
          normalizedTerm: normalizeKeyword(term),
          score,
          competition: scoreToCompetition(score),
          status: 'new',
          observedAt: new Date().toISOString(),
          sourceItemId: extractTag(item, 'guid') ?? extractTag(item, 'link'),
          payload: {
            publication: feed.publication,
            title,
            link: extractTag(item, 'link'),
            published_at: extractTag(item, 'pubDate') ?? extractTag(item, 'dc:date'),
          },
        });
      }

      console.log(`[industry-rss] ${feed.publication}: parsed ${items.length} items`);
    } catch (error) {
      console.warn(`[industry-rss] ${feed.publication}: ingestion error (non-fatal)`, error instanceof Error ? error.message : String(error));
    }
  }

  return rows;
}

async function ingestNewsApi(): Promise<TrendSeed[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  const rows: TrendSeed[] = [];
  const queries = [
    'smart ring wearable',
    'recovery wearable',
    'sleep tracking ring',
    'HRV wearable',
    'readiness score wearable',
    'fitness wearable review',
  ];

  for (const q of queries) {
    try {
      const url = new URL('https://newsapi.org/v2/everything');
      url.searchParams.set('q', q);
      url.searchParams.set('sortBy', 'publishedAt');
      url.searchParams.set('pageSize', '10');
      url.searchParams.set('language', 'en');
      url.searchParams.set('apiKey', apiKey);

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'recoverystack-trend-scraper/1.0' },
      });

      if (!res.ok) {
        console.warn(`[newsapi] Query "${q}" failed: ${res.status}`);
        continue;
      }

      const json = await res.json();
      const articles: Array<{ title?: string; url?: string; publishedAt?: string; source?: { name?: string } }> = json?.articles ?? [];

      for (const article of articles) {
        if (!article.title) continue;
        const term = normalizeTerm(article.title);
        if (!term || term.length < 4) continue;

        const score = heuristicScoreFromLength(70, term); // NewsAPI articles score higher — editorial, timely

        rows.push({
          term,
          source: 'news_api',
          normalizedTerm: normalizeKeyword(term),
          score,
          competition: scoreToCompetition(score),
          status: 'new',
          observedAt: new Date().toISOString(),
          sourceItemId: article.url ?? null,
          payload: {
            query: q,
            title: article.title,
            url: article.url ?? null,
            source: article.source?.name ?? null,
            published_at: article.publishedAt ?? null,
          },
        });
      }

      console.log(`[newsapi] "${q}": ${articles.length} articles`);
    } catch (error) {
      console.warn(`[newsapi] Query "${q}" error (non-fatal):`, error instanceof Error ? error.message : String(error));
    }
  }

  return rows;
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
        normalizedTerm: normalizeKeyword(term),
        score,
        competition: scoreToCompetition(score),
        status: 'new',
        observedAt: new Date().toISOString(),
        approxTraffic,
        sourceItemId: title,
        payload: {
          approx_traffic: approxTraffic,
          title,
          geo: process.env.GOOGLE_TRENDS_GEO ?? 'US',
        },
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

  // Deduplicate by normalized term and keep the strongest recent observation.
  const deduped = new Map<string, TrendSeed>();
  for (const row of rows) {
    const existing = deduped.get(row.normalizedTerm);
    if (!existing || row.score > existing.score) {
      deduped.set(row.normalizedTerm, row);
    }
  }

  const normalizedTerms = Array.from(deduped.keys());
  const { data: existingRows, error: existingError } = await supabase
    .from('trends')
    .select('id,normalized_term,status,source_count,sighting_count,first_seen_at,last_seen_at')
    .in('normalized_term', normalizedTerms);

  if (existingError) {
    throw new Error(`Supabase trend lookup failed: ${existingError.message}`);
  }

  const existingByNormalized = new Map(
    (existingRows ?? []).map((row: any) => [String(row.normalized_term), row]),
  );

  const payload = Array.from(deduped.values()).map((row) => {
    const existing = existingByNormalized.get(row.normalizedTerm);
    return {
      term: row.term,
      normalized_term: row.normalizedTerm,
      source: row.source,
      score: row.score / 100,
      trend_score: row.score,
      priority: row.score,
      competition: row.competition,
      status: existing?.status ?? 'new',
      metadata: row.payload,
      search_volume: row.approxTraffic ? parseApproxTraffic(row.approxTraffic) : null,
      source_count: existing ? Number(existing.source_count ?? 1) : 1,
      sighting_count: existing ? Number(existing.sighting_count ?? 1) + 1 : 1,
      first_seen_at: existing?.first_seen_at ?? row.observedAt,
      last_seen_at: row.observedAt,
    };
  });

  const { error } = await supabase.from('trends').upsert(payload, {
    onConflict: 'normalized_term',
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  const { data: trendRows, error: trendFetchError } = await supabase
    .from('trends')
    .select('id,normalized_term')
    .in('normalized_term', normalizedTerms);

  if (trendFetchError) {
    throw new Error(`Supabase trend fetch failed: ${trendFetchError.message}`);
  }

  const trendIdByNormalized = new Map(
    (trendRows ?? []).map((row: any) => [String(row.normalized_term), String(row.id)]),
  );

  const observationPayload = rows.map((row) => ({
    trend_id: trendIdByNormalized.get(row.normalizedTerm) ?? null,
    normalized_term: row.normalizedTerm,
    raw_term: row.term,
    source: row.source,
    source_item_id: row.sourceItemId ?? null,
    observed_at: row.observedAt,
    score: row.score,
    approx_traffic: row.approxTraffic ?? null,
    geo: row.source === 'gtrends' ? process.env.GOOGLE_TRENDS_GEO ?? 'US' : null,
    payload: row.payload,
  }));

  const { error: observationError } = await supabase.from('trend_observations').insert(observationPayload);
  if (observationError) {
    throw new Error(`Supabase trend observation insert failed: ${observationError.message}`);
  }

  return payload.length;
}

function parseApproxTraffic(approxTraffic: string): number | null {
  const normalized = approxTraffic.replace(/,/g, '').toUpperCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([KM])?/);
  if (!match) return null;

  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;

  const multiplier = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1;
  return Math.round(raw * multiplier);
}

// ── YouTube Data API v3 signal ingestion ────────────────────────────────────
// Pulls trending/recent videos from recovery-relevant YouTube channels and search
// terms. High-view-count recovery/wearables videos are a leading indicator of
// consumer interest — topics that go viral on YouTube often surface as SEO demand
// 2-4 weeks later.
//
// Requires: YOUTUBE_API_KEY env var.
// Optional: YOUTUBE_CHANNEL_IDS (comma-separated) to override default channels.

const YOUTUBE_SEARCH_QUERIES = [
  'best smart ring 2025',
  'oura ring review',
  'whoop review',
  'oura vs whoop',
  'best recovery wearable',
  'best hrv wearable',
  'sleep tracking ring',
];

// Channels known for high-quality recovery/fitness tech content
const DEFAULT_YOUTUBE_CHANNEL_IDS = [
  'UCaBqRxHEMomgFU-AkSfodCw', // Thomas DeLauer
  'UCWX3yGbOBM6TGMoOSHiCPdQ', // Huberman Lab (partial)
];

async function ingestYouTube(): Promise<TrendSeed[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const rows: TrendSeed[] = [];
  const channelIds = process.env.YOUTUBE_CHANNEL_IDS
    ? process.env.YOUTUBE_CHANNEL_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_YOUTUBE_CHANNEL_IDS;

  // 1. Search-based signal: recent videos matching our queries
  for (const q of YOUTUBE_SEARCH_QUERIES) {
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', q);
      url.searchParams.set('type', 'video');
      url.searchParams.set('order', 'date');
      url.searchParams.set('maxResults', '10');
      url.searchParams.set('publishedAfter', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      url.searchParams.set('key', apiKey);

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'recoverystack-trend-scraper/1.0' },
      });

      if (!res.ok) {
        console.warn(`[youtube] Search "${q}" failed: ${res.status}`);
        continue;
      }

      const json = await res.json();
      const items: Array<{ id?: { videoId?: string }; snippet?: { title?: string; publishedAt?: string; channelTitle?: string } }> = json?.items ?? [];

      for (const item of items) {
        const title = item.snippet?.title;
        if (!title) continue;

        const term = normalizeTerm(title);
        if (!term || term.length < 4) continue;

        // YouTube editorial/creator content: score slightly above Reddit
        const score = heuristicScoreFromLength(68, term);

        rows.push({
          term,
          source: 'youtube_search',
          normalizedTerm: normalizeKeyword(term),
          score,
          competition: scoreToCompetition(score),
          status: 'new',
          observedAt: new Date().toISOString(),
          sourceItemId: item.id?.videoId ?? null,
          payload: {
            source_type: 'youtube_search',
            query: q,
            title,
            video_id: item.id?.videoId ?? null,
            channel: item.snippet?.channelTitle ?? null,
            published_at: item.snippet?.publishedAt ?? null,
          },
        });
      }

      console.log(`[youtube] search "${q}": ${items.length} videos`);
    } catch (error) {
      console.warn(`[youtube] Search "${q}" error (non-fatal):`, error instanceof Error ? error.message : String(error));
    }
  }

  // 2. Channel-based signal: recent uploads from known channels
  for (const channelId of channelIds) {
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('channelId', channelId);
      url.searchParams.set('type', 'video');
      url.searchParams.set('order', 'date');
      url.searchParams.set('maxResults', '5');
      url.searchParams.set('key', apiKey);

      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'recoverystack-trend-scraper/1.0' },
      });

      if (!res.ok) {
        console.warn(`[youtube] Channel ${channelId} failed: ${res.status}`);
        continue;
      }

      const json = await res.json();
      const items: Array<{ id?: { videoId?: string }; snippet?: { title?: string; publishedAt?: string; channelTitle?: string } }> = json?.items ?? [];

      for (const item of items) {
        const title = item.snippet?.title;
        if (!title) continue;

        const term = normalizeTerm(title);
        if (!term || term.length < 4) continue;

        const score = heuristicScoreFromLength(72, term); // Channel content scores higher (curated source)

        rows.push({
          term,
          source: 'youtube_channel',
          normalizedTerm: normalizeKeyword(term),
          score,
          competition: scoreToCompetition(score),
          status: 'new',
          observedAt: new Date().toISOString(),
          sourceItemId: item.id?.videoId ?? null,
          payload: {
            source_type: 'youtube_channel',
            channel_id: channelId,
            title,
            video_id: item.id?.videoId ?? null,
            channel: item.snippet?.channelTitle ?? null,
            published_at: item.snippet?.publishedAt ?? null,
          },
        });
      }

      console.log(`[youtube] channel ${channelId}: ${items.length} videos`);
    } catch (error) {
      console.warn(`[youtube] Channel ${channelId} error (non-fatal):`, error instanceof Error ? error.message : String(error));
    }
  }

  return rows;
}

async function run() {
  const [redditRows, googleRows, industryRows, newsApiRows, youtubeRows] = await Promise.all([
    ingestReddit(),
    ingestGoogleTrends(),
    ingestIndustryRss(),
    ingestNewsApi(),
    ingestYouTube(),
  ]);
  const allRows = [...redditRows, ...googleRows, ...industryRows, ...newsApiRows, ...youtubeRows];

  if (!allRows.length) {
    console.warn('No trend rows collected from feeds. Exiting without DB writes.');
    return;
  }

  // Domain relevance filter: only keep terms in our recovery/fitness/health-tech domain
  const relevant: TrendSeed[] = [];
  const skipped: string[] = [];

  for (const row of allRows) {
    const assessment = assessTrendRelevance(row.term, row.source);
    if (assessment.relevant) {
      row.payload = {
        ...row.payload,
        relevance_score: assessment.score,
        relevance_matches: assessment.matches,
      };
      relevant.push(row);
    } else {
      skipped.push(`${row.term} [score=${assessment.score}${assessment.blockedBy.length ? ` blocked=${assessment.blockedBy.join(',')}` : ''}]`);
    }
  }

  if (skipped.length) {
    console.log(`[relevance-filter] skipped ${skipped.length} off-topic terms (first 10): ${skipped.slice(0, 10).join(' | ')}`);
  }

  if (!relevant.length) {
    console.warn('[relevance-filter] all collected trends were off-topic. Nothing to upsert.');
    return;
  }

  const written = await upsertTrends(relevant);
  console.log(
    `Trend ingestion complete. collected=${allRows.length} relevant=${relevant.length} skipped=${skipped.length} upserted=${written}`,
  );
}

run().catch((error) => {
  console.error('Trend ingestion failed:', error);
  process.exit(1);
});
