/**
 * Community Sentiment Miner
 *
 * Mines recovery-tech community platforms for high-signal Q&A content:
 *
 *   1. Reddit discussions — both positive praise and complaints, sorted by engagement
 *   2. Reddit Q&A threads — question + top answer pairs for FAQ extraction
 *   3. YouTube comment threads — real user language from recovery-related videos
 *   4. Garmin Connect Community (RSS)
 *   5. WHOOP community posts (public blog comments / discussion)
 *
 * For each keyword in the pipeline, finds:
 *   - Exact questions users ask in their own language
 *   - Positive praise phrases (benefit language to use in content)
 *   - Pain point descriptions (problems to address)
 *   - User vocabulary (words they actually use, not marketing language)
 *
 * Output:
 *   - `community_qa` table entries used by brief-generator.ts
 *   - Updates `briefs.community_questions` and `briefs.positive_sentiment_phrases`
 *
 * Usage:
 *   npx tsx scripts/community-sentiment-miner.ts
 *   COMMUNITY_MINER_LIMIT=30 npx tsx scripts/community-sentiment-miner.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.COMMUNITY_MINER_LIMIT ?? 25);
const REFRESH_AFTER_DAYS = Number(process.env.COMMUNITY_REFRESH_DAYS ?? 14);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Recovery-specific community subreddits for sentiment mining
const COMMUNITY_SUBREDDITS = [
  'ouraring', 'whoop', 'GarminWatches', 'Biohackers', 'fitness', 'running',
  'triathlon', 'weightlifting', 'EightSleep', 'AppleWatch', 'wearables',
  'sleep', 'insomnia', 'ResearchChemicals', 'Supplements', 'longevity',
];

// Sentiment word banks for basic classification
const POSITIVE_INDICATORS = [
  'love', 'amazing', 'great', 'excellent', 'perfect', 'best', 'better', 'improved',
  'helped', 'works', 'accurate', 'worth', 'recommend', 'impressed', 'surprised',
  'game changer', 'difference', 'noticeable', 'significant', 'consistent',
];

const NEGATIVE_INDICATORS = [
  'hate', 'terrible', 'awful', 'wrong', 'inaccurate', 'broken', 'issue', 'problem',
  'doesn\'t work', 'waste', 'disappointed', 'frustrating', 'useless', 'buggy',
  'worst', 'regret', 'returned', 'stopped', 'glitch', 'freeze', 'crash',
];

function classifySentiment(text: string): { sentiment: string; score: number } {
  const lower = text.toLowerCase();
  let positiveCount = POSITIVE_INDICATORS.filter((w) => lower.includes(w)).length;
  let negativeCount = NEGATIVE_INDICATORS.filter((w) => lower.includes(w)).length;

  const total = positiveCount + negativeCount || 1;
  const score = (positiveCount - negativeCount) / total;

  let sentiment = 'neutral';
  if (score > 0.3) sentiment = 'positive';
  else if (score < -0.3) sentiment = 'negative';
  else if (positiveCount > 0 && negativeCount > 0) sentiment = 'mixed';

  return { sentiment, score: Math.round(score * 1000) / 1000 };
}

function isQuestion(text: string): boolean {
  return /\?/.test(text) || /^(how|what|why|when|where|which|is|are|does|do|can|should|will|has|have)\s/i.test(text.trim());
}

function extractEntities(text: string): string[] {
  const brands = ['oura', 'whoop', 'garmin', 'polar', 'eight sleep', 'therabody', 'theragun', 'apple watch', 'fitbit', 'withings'];
  const metrics = ['hrv', 'heart rate', 'sleep score', 'readiness', 'rhr', 'spo2', 'recovery score', 'strain'];
  const topics = ['cold plunge', 'sauna', 'protein', 'creatine', 'magnesium', 'sleep stages', 'rem', 'deep sleep'];
  const all = [...brands, ...metrics, ...topics];
  const lower = text.toLowerCase();
  return all.filter((e) => lower.includes(e));
}

/**
 * Mine Reddit for Q&A and sentiment on a given keyword.
 * Uses Reddit's public JSON API (no auth required for public data).
 */
async function mineReddit(keyword: string, pageSlug: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];

  for (const subreddit of COMMUNITY_SUBREDDITS.slice(0, 8)) {
    try {
      await rateLimit('reddit');

      const searchUrl = new URL(`https://www.reddit.com/r/${subreddit}/search.json`);
      searchUrl.searchParams.set('q', keyword);
      searchUrl.searchParams.set('sort', 'top');
      searchUrl.searchParams.set('t', 'year');
      searchUrl.searchParams.set('limit', '10');
      searchUrl.searchParams.set('type', 'link');

      const res = await fetch(searchUrl.toString(), {
        headers: {
          'User-Agent': 'recoverystack-community-miner/1.0 (by /u/recoverystack)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) continue;
      const json = await res.json();
      const posts = json?.data?.children ?? [];

      for (const post of posts) {
        const d = post?.data;
        if (!d?.title || !d?.subreddit) continue;

        const title = String(d.title);
        const body = d.selftext ? String(d.selftext).slice(0, 500) : '';
        const text = `${title} ${body}`;
        const { sentiment, score } = classifySentiment(text);
        const entities = extractEntities(text);

        if (isQuestion(title) && d.score >= 5) {
          // This is a Q&A opportunity
          rows.push({
            keyword,
            page_slug: pageSlug,
            source: 'reddit',
            source_url: `https://reddit.com${d.permalink}`,
            question: title,
            best_answer: body.length > 20 ? body.slice(0, 300) : null,
            upvotes: d.score ?? 0,
            reply_count: d.num_comments ?? 0,
            sentiment,
            sentiment_score: score,
            user_language: title,
            entity_mentions: entities,
            beat: 'general_recovery',
            relevance_score: Math.min(100, Math.round(30 + Math.log10(Math.max(1, d.score)) * 20)),
            captured_at: new Date().toISOString(),
          });
        } else if ((d.score >= 20) && (sentiment === 'positive' || sentiment === 'negative')) {
          // High-engagement sentiment post — useful for understanding user vocabulary
          rows.push({
            keyword,
            page_slug: pageSlug,
            source: 'reddit',
            source_url: `https://reddit.com${d.permalink}`,
            question: title,
            best_answer: body.length > 20 ? body.slice(0, 300) : null,
            upvotes: d.score ?? 0,
            reply_count: d.num_comments ?? 0,
            sentiment,
            sentiment_score: score,
            user_language: title,
            entity_mentions: entities,
            beat: 'general_recovery',
            relevance_score: Math.min(100, Math.round(40 + Math.log10(Math.max(1, d.score)) * 15)),
            captured_at: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Non-fatal — try next subreddit
    }
  }

  return rows;
}

/**
 * Mine Reddit for top-comment Q&A within high-engagement threads.
 * Fetches comments from top-scored posts to get answer language.
 */
async function mineRedditComments(keyword: string, pageSlug: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];

  try {
    await rateLimit('reddit');

    // Search for question-style posts specifically
    const searchUrl = new URL('https://www.reddit.com/search.json');
    searchUrl.searchParams.set('q', `${keyword} site:reddit.com`);
    searchUrl.searchParams.set('sort', 'top');
    searchUrl.searchParams.set('t', 'year');
    searchUrl.searchParams.set('limit', '5');

    const res = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'recoverystack-community-miner/1.0 (by /u/recoverystack)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return rows;
    const json = await res.json();
    const posts = (json?.data?.children ?? []).slice(0, 3);

    for (const post of posts) {
      const d = post?.data;
      if (!d?.permalink || !isQuestion(d?.title ?? '')) continue;

      // Fetch comments for this post
      await rateLimit('reddit');
      const commentsRes = await fetch(`https://www.reddit.com${d.permalink}.json?limit=10&sort=best`, {
        headers: {
          'User-Agent': 'recoverystack-community-miner/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!commentsRes.ok) continue;
      const commentsJson = await commentsRes.json();
      const comments = commentsJson?.[1]?.data?.children ?? [];

      const topComment = comments
        .filter((c: any) => c?.data?.body && c.data.score >= 5)
        .sort((a: any, b: any) => b.data.score - a.data.score)[0];

      if (topComment) {
        const answer = String(topComment.data.body).slice(0, 400);
        const entities = extractEntities(`${d.title} ${answer}`);
        const { sentiment, score } = classifySentiment(answer);

        rows.push({
          keyword,
          page_slug: pageSlug,
          source: 'reddit',
          source_url: `https://reddit.com${d.permalink}`,
          question: String(d.title),
          best_answer: answer,
          upvotes: topComment.data.score ?? 0,
          reply_count: d.num_comments ?? 0,
          sentiment,
          sentiment_score: score,
          user_language: String(d.title),
          entity_mentions: entities,
          beat: 'general_recovery',
          relevance_score: 75,
          captured_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-fatal
  }

  return rows;
}

/**
 * Mine YouTube video comments for a keyword.
 * Uses YouTube Data API v3.
 */
async function mineYouTubeComments(keyword: string, pageSlug: string): Promise<Array<Record<string, unknown>>> {
  if (!YOUTUBE_API_KEY) return [];

  const rows: Array<Record<string, unknown>> = [];

  try {
    // First find relevant videos
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', keyword);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('order', 'relevance');
    searchUrl.searchParams.set('maxResults', '3');
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY);

    const searchRes = await fetch(searchUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!searchRes.ok) return rows;

    const searchJson = await searchRes.json();
    const videos = (searchJson?.items ?? []).slice(0, 2);

    for (const video of videos) {
      const videoId = video?.id?.videoId;
      if (!videoId) continue;

      // Fetch top comments
      const commentsUrl = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
      commentsUrl.searchParams.set('part', 'snippet');
      commentsUrl.searchParams.set('videoId', videoId);
      commentsUrl.searchParams.set('order', 'relevance');
      commentsUrl.searchParams.set('maxResults', '20');
      commentsUrl.searchParams.set('key', YOUTUBE_API_KEY);

      const commentsRes = await fetch(commentsUrl.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!commentsRes.ok) continue;

      const commentsJson = await commentsRes.json();
      const comments = commentsJson?.items ?? [];

      for (const item of comments) {
        const comment = item?.snippet?.topLevelComment?.snippet;
        if (!comment?.textDisplay) continue;

        const text = String(comment.textDisplay).replace(/<[^>]+>/g, '').trim();
        if (text.length < 20 || text.length > 500) continue;

        const likeCount = comment.likeCount ?? 0;
        if (likeCount < 2 && !isQuestion(text)) continue;

        const { sentiment, score } = classifySentiment(text);
        const entities = extractEntities(text);

        rows.push({
          keyword,
          page_slug: pageSlug,
          source: 'youtube_comments',
          source_url: `https://youtube.com/watch?v=${videoId}`,
          question: isQuestion(text) ? text : null,
          best_answer: isQuestion(text) ? null : text,
          upvotes: likeCount,
          reply_count: item?.snippet?.totalReplyCount ?? 0,
          sentiment,
          sentiment_score: score,
          user_language: text.slice(0, 200),
          entity_mentions: entities,
          beat: 'general_recovery',
          relevance_score: Math.min(100, 50 + likeCount * 2),
          captured_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-fatal
  }

  return rows;
}

/**
 * Aggregate results: extract summary phrases for briefs.
 */
function aggregatePhrases(rows: Array<Record<string, unknown>>): {
  questions: string[];
  positivePhrases: string[];
} {
  const questions = rows
    .filter((r) => r.question && isQuestion(String(r.question)))
    .sort((a, b) => (b.upvotes as number ?? 0) - (a.upvotes as number ?? 0))
    .map((r) => String(r.question))
    .slice(0, 15);

  const positivePhrases = rows
    .filter((r) => r.sentiment === 'positive' && r.user_language)
    .sort((a, b) => (b.upvotes as number ?? 0) - (a.upvotes as number ?? 0))
    .map((r) => String(r.user_language).slice(0, 100))
    .slice(0, 10);

  return { questions, positivePhrases };
}

async function processKeyword(pageSlug: string, keyword: string): Promise<void> {
  const [redditRows, commentRows, ytRows] = await Promise.all([
    mineReddit(keyword, pageSlug),
    mineRedditComments(keyword, pageSlug),
    mineYouTubeComments(keyword, pageSlug),
  ]);

  const allRows = [...redditRows, ...commentRows, ...ytRows];

  if (allRows.length === 0) {
    console.log(`[community-miner] No community data found for "${keyword}"`);
    return;
  }

  console.log(`[community-miner] "${keyword}": ${allRows.length} rows (${redditRows.length} Reddit, ${commentRows.length} Reddit comments, ${ytRows.length} YouTube)`);

  if (isDryRun) {
    allRows.slice(0, 3).forEach((r) => console.log(`  [${r.sentiment}] ${String(r.question ?? r.user_language ?? '').slice(0, 100)}`));
    return;
  }

  // Upsert to community_qa (no unique constraint — allow duplicates from different runs)
  const { error } = await supabase.from('community_qa').insert(allRows);
  if (error) {
    console.warn(`[community-miner] DB write failed for "${keyword}": ${error.message}`);
    return;
  }

  // Update brief with community intelligence
  const { questions, positivePhrases } = aggregatePhrases(allRows);
  if (questions.length > 0 || positivePhrases.length > 0) {
    await supabase
      .from('briefs')
      .update({
        community_questions: questions,
        positive_sentiment_phrases: positivePhrases,
      })
      .eq('page_slug', pageSlug);
  }
}

async function run(): Promise<void> {
  console.log(`[community-sentiment-miner] Starting (${isDryRun ? 'DRY RUN' : 'LIVE'})...`);

  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Load draft pages that need community data
  const { data: pages } = await supabase
    .from('pages')
    .select('slug, primary_keyword')
    .eq('status', 'draft')
    .not('primary_keyword', 'is', null)
    .limit(LIMIT);

  if (!pages || pages.length === 0) {
    console.log('[community-sentiment-miner] No draft pages found.');
    return;
  }

  // Filter: skip recently mined keywords
  const { data: recentMined } = await supabase
    .from('community_qa')
    .select('keyword')
    .gte('captured_at', cutoff);

  const recentKeywords = new Set((recentMined ?? []).map((r: any) => String(r.keyword).toLowerCase()));

  const toProcess = pages.filter((p: any) => !recentKeywords.has(String(p.primary_keyword).toLowerCase()));

  console.log(`[community-sentiment-miner] Processing ${toProcess.length}/${pages.length} keywords...`);

  for (const page of toProcess) {
    try {
      await processKeyword(page.slug as string, page.primary_keyword as string);
      // Small delay between keywords to be respectful of rate limits
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`[community-miner] Failed for "${page.primary_keyword}":`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log('[community-sentiment-miner] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
