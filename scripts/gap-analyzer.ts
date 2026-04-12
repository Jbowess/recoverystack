import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'best',
  'by',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'vs',
  'what',
  'when',
  'which',
  'with',
  'your',
]);

type KeywordTarget = {
  pageSlug: string;
  keyword: string;
  source: 'page' | 'trend';
};

type SerpOrganicResult = {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
};

type PeopleAlsoAskItem = {
  question: string;
  snippet?: string;
  link?: string;
};

type SerpRelatedSearch = {
  query: string;
};

function normalizeTokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function toTitleCasePhrase(words: string[]) {
  return words.map((w) => `${w[0]?.toUpperCase() ?? ''}${w.slice(1)}`).join(' ');
}

function extractHeadingCandidates(results: SerpOrganicResult[]) {
  const headingFreq = new Map<string, number>();

  for (const result of results) {
    const raw = `${result.title ?? ''}. ${result.snippet ?? ''}`;
    const segments = raw
      .split(/[|:\-\.\?!•]+/g)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);

    for (const segment of segments) {
      const words = normalizeTokens(segment);
      if (words.length < 3) continue;

      // Keep compact 3-6 token phrase to emulate heading ideas.
      const phrase = toTitleCasePhrase(words.slice(0, Math.min(words.length, 6)));
      if (phrase.length < 12) continue;

      headingFreq.set(phrase, (headingFreq.get(phrase) ?? 0) + 1);
    }
  }

  return [...headingFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([heading]) => heading);
}

function extractEntityGaps(keyword: string, results: SerpOrganicResult[]) {
  const keywordTokens = new Set(normalizeTokens(keyword));
  const freq = new Map<string, number>();

  for (const result of results) {
    const text = `${result.title ?? ''} ${result.snippet ?? ''}`;
    const words = normalizeTokens(text);

    for (const word of words) {
      if (keywordTokens.has(word)) continue;
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([entity]) => entity);
}

async function fetchTopSerp(keyword: string) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return null;

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', keyword);
  url.searchParams.set('num', '5');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'au');
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`SERP API error ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const organic = (payload?.organic_results ?? []) as SerpOrganicResult[];

  // Extract People Also Ask questions
  const rawPaa = payload?.related_questions ?? [];
  const peopleAlsoAsk: PeopleAlsoAskItem[] = (Array.isArray(rawPaa) ? rawPaa : [])
    .filter((item: any) => item?.question && typeof item.question === 'string')
    .slice(0, 8)
    .map((item: any) => ({
      question: String(item.question),
      snippet: item.snippet ? String(item.snippet) : undefined,
      link: item.link ? String(item.link) : undefined,
    }));

  // Extract Related Searches
  const rawRelated = payload?.related_searches ?? [];
  const relatedSearches: SerpRelatedSearch[] = (Array.isArray(rawRelated) ? rawRelated : [])
    .filter((item: any) => item?.query && typeof item.query === 'string')
    .slice(0, 10)
    .map((item: any) => ({ query: String(item.query) }));

  return {
    organic: organic.slice(0, 5).map((r) => ({
      position: r.position,
      title: r.title,
      link: r.link,
      snippet: r.snippet,
    })),
    peopleAlsoAsk,
    relatedSearches,
  };
}

async function loadPendingKeywords(): Promise<KeywordTarget[]> {
  const [pagesRes, trendsRes] = await Promise.all([
    supabase
      .from('pages')
      .select('slug,primary_keyword,status')
      .eq('status', 'draft')
      .not('primary_keyword', 'is', null)
      .limit(50),
    supabase.from('trends').select('term,status').eq('status', 'new').limit(50),
  ]);

  if (pagesRes.error) throw pagesRes.error;
  if (trendsRes.error) throw trendsRes.error;

  const pageKeywords: KeywordTarget[] = (pagesRes.data ?? [])
    .filter((p) => typeof p.primary_keyword === 'string' && p.primary_keyword.trim().length > 0)
    .map((p) => ({ pageSlug: p.slug as string, keyword: (p.primary_keyword as string).trim(), source: 'page' }));

  const trendKeywords: KeywordTarget[] = (trendsRes.data ?? [])
    .filter((t) => typeof t.term === 'string' && t.term.trim().length > 0)
    .map((t) => ({ pageSlug: `trend:${(t.term as string).trim().toLowerCase().replace(/\s+/g, '-')}`, keyword: (t.term as string).trim(), source: 'trend' }));

  const dedup = new Map<string, KeywordTarget>();
  for (const item of [...pageKeywords, ...trendKeywords]) {
    const key = `${item.pageSlug}::${item.keyword.toLowerCase()}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }

  return [...dedup.values()];
}

async function run() {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.log('Skipping gap analysis: SERPAPI_API_KEY is not set.');
    return;
  }

  const targets = await loadPendingKeywords();
  if (!targets.length) {
    console.log('No pending page/trend keywords found.');
    return;
  }

  let inserted = 0;

  for (const target of targets) {
    try {
      const serp = await fetchTopSerp(target.keyword);
      if (!serp || serp.organic.length === 0) {
        console.log(`No SERP results for: ${target.keyword}`);
        continue;
      }

      const headingGaps = extractHeadingCandidates(serp.organic);
      const missingEntities = extractEntityGaps(target.keyword, serp.organic);

      const serpSnapshot = {
        source: target.source,
        queried_at: new Date().toISOString(),
        keyword: target.keyword,
        heading_gaps: headingGaps,
        top_results: serp.organic,
        people_also_ask: serp.peopleAlsoAsk,
        related_searches: serp.relatedSearches,
      };

      const { error } = await supabase.from('content_gaps').insert({
        page_slug: target.pageSlug,
        keyword: target.keyword,
        missing_entities: missingEntities,
        serp_snapshot: serpSnapshot,
      });

      if (error) throw error;
      inserted += 1;
    } catch (error) {
      console.error(`Gap analysis failed for "${target.keyword}":`, error);
    }
  }

  console.log(`Gap analysis complete. Inserted ${inserted} content_gaps row(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
