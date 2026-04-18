/**
 * App Review Miner
 *
 * Mines iOS App Store and Google Play reviews for wearable/recovery apps.
 * Extracts pain points, praised features, and comparison mentions to enrich
 * briefs with real user language — the exact phrasing searchers use when
 * forming queries, which improves content resonance and CTR.
 *
 * Sources:
 *   - iTunes RSS feeds (free, no key, 500 reviews/app)
 *   - Google Play via itunes-app-scraper style public endpoint
 *   - Stores results in `app_reviews` table
 *   - Aggregates sentiment + themes into `app_review_aggregates`
 *   - Updates `briefs.product_sentiment` for matching page slugs
 *
 * Usage:
 *   npx tsx scripts/app-review-miner.ts
 *   npx tsx scripts/app-review-miner.ts --dry-run
 *   APP_REVIEW_LIMIT=200 npx tsx scripts/app-review-miner.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LIMIT = Number(process.env.APP_REVIEW_LIMIT ?? 150);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const REFRESH_AFTER_DAYS = Number(process.env.APP_REVIEW_REFRESH_DAYS ?? 7);

// ── Target apps ───────────────────────────────────────────────────────────────
const TARGET_APPS = [
  // Wearable companion apps
  { name: 'Whoop', slug: 'whoop', ios_id: '1355049948', play_id: 'com.whoop.android', beat: 'wearables' },
  { name: 'Oura Ring', slug: 'oura-ring', ios_id: '1043837948', play_id: 'fi.ouraring.oura', beat: 'wearables' },
  { name: 'Garmin Connect', slug: 'garmin', ios_id: '583446403', play_id: 'com.garmin.android.apps.connectmobile', beat: 'wearables' },
  { name: 'Polar Flow', slug: 'polar', ios_id: '717172644', play_id: 'fi.polar.polarflow', beat: 'wearables' },
  { name: 'Fitbit', slug: 'fitbit', ios_id: '462638897', play_id: 'com.fitbit.FitbitMobile', beat: 'wearables' },
  { name: 'Apple Health', slug: 'apple-health', ios_id: '1242545199', play_id: null, beat: 'health_monitoring' },
  { name: 'Eight Sleep', slug: 'eight-sleep', ios_id: '1048710403', play_id: 'com.eightsleep.eightsleep', beat: 'sleep_tech' },
  { name: 'Withings Health Mate', slug: 'withings', ios_id: '542701020', play_id: 'com.withings.wiscale2', beat: 'wearables' },
  { name: 'HRV4Training', slug: 'hrv4training', ios_id: '945124822', play_id: 'com.hrv4training.hrv4training', beat: 'hrv_training' },
  { name: 'Elite HRV', slug: 'elite-hrv', ios_id: '870348407', play_id: 'com.elitehrv.elitehrv', beat: 'hrv_training' },
  // Recovery / training apps
  { name: 'Therabody', slug: 'therabody', ios_id: '1437889175', play_id: 'com.theragun.theragun', beat: 'recovery_modalities' },
  { name: 'Normatec', slug: 'normatec', ios_id: '1219072483', play_id: 'com.hyperice.hyperice', beat: 'recovery_modalities' },
  { name: 'Whoop Coach', slug: 'whoop-coach', ios_id: '1355049948', play_id: null, beat: 'ai_coaching' },
] as const;

type AppConfig = (typeof TARGET_APPS)[number];

type ReviewRow = {
  review_key: string;
  app_slug: string;
  app_name: string;
  platform: 'ios' | 'android';
  rating: number;
  title: string | null;
  body: string;
  author: string | null;
  review_date: string | null;
  version: string | null;
  helpful_count: number;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  pain_points: string[];
  praised_features: string[];
  competitor_mentions: string[];
  themes: string[];
  beat: string;
  fetched_at: string;
};

// ── Sentiment + theme extraction ──────────────────────────────────────────────
const PAIN_POINT_SIGNALS = [
  'doesn\'t work', 'not working', 'broken', 'bug', 'crash', 'freezes', 'won\'t sync',
  'inaccurate', 'wrong', 'off by', 'drains battery', 'subscription', 'expensive',
  'overpriced', 'disconnects', 'slow', 'laggy', 'annoying', 'waste of money',
  'disappointed', 'misleading', 'stopped working', 'unusable', 'terrible',
  'glitch', 'error', 'fails', 'issue', 'problem',
];

const PRAISE_SIGNALS = [
  'love', 'amazing', 'excellent', 'accurate', 'helpful', 'easy to use', 'great',
  'best', 'recommend', 'perfect', 'fantastic', 'intuitive', 'works well',
  'changed my life', 'worth it', 'solid', 'reliable', 'impressive', 'detailed',
  'insightful', 'motivating', 'game changer', 'seamless',
];

const COMPETITOR_NAMES = [
  'whoop', 'oura', 'garmin', 'polar', 'fitbit', 'apple watch', 'samsung',
  'theragun', 'hyperice', 'normatec', 'eight sleep', 'withings', 'biostrap',
  'suunto', 'coros', 'wahoo', 'peloton',
];

const RECOVERY_THEMES = [
  { theme: 'hrv_accuracy', signals: ['hrv', 'heart rate variability', 'readiness'] },
  { theme: 'sleep_tracking', signals: ['sleep', 'deep sleep', 'rem', 'sleep score'] },
  { theme: 'battery_life', signals: ['battery', 'charge', 'charging'] },
  { theme: 'subscription_value', signals: ['subscription', 'membership', 'premium', 'cost', 'price'] },
  { theme: 'data_accuracy', signals: ['accurate', 'accuracy', 'inaccurate', 'wrong reading'] },
  { theme: 'app_stability', signals: ['crash', 'bug', 'freezes', 'glitch', 'update'] },
  { theme: 'sync_reliability', signals: ['sync', 'connect', 'bluetooth', 'connection'] },
  { theme: 'coaching_insights', signals: ['coach', 'recommendation', 'insight', 'advice', 'suggestion'] },
  { theme: 'recovery_score', signals: ['recovery', 'strain', 'readiness', 'score'] },
  { theme: 'workout_detection', signals: ['workout', 'exercise', 'activity', 'auto detect'] },
];

function classifySentiment(text: string, rating: number): ReviewRow['sentiment'] {
  const lower = text.toLowerCase();
  const positiveHits = PRAISE_SIGNALS.filter((s) => lower.includes(s)).length;
  const negativeHits = PAIN_POINT_SIGNALS.filter((s) => lower.includes(s)).length;

  if (rating >= 4 && positiveHits > 0 && negativeHits === 0) return 'positive';
  if (rating <= 2 && negativeHits > 0 && positiveHits === 0) return 'negative';
  if (positiveHits > 0 && negativeHits > 0) return 'mixed';
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

function extractPainPoints(text: string): string[] {
  const lower = text.toLowerCase();
  return PAIN_POINT_SIGNALS
    .filter((s) => lower.includes(s))
    .map((s) => {
      // Extract a short phrase around the signal
      const idx = lower.indexOf(s);
      const start = Math.max(0, idx - 20);
      const end = Math.min(text.length, idx + s.length + 30);
      return text.slice(start, end).trim();
    })
    .slice(0, 5);
}

function extractPraisedFeatures(text: string): string[] {
  const lower = text.toLowerCase();
  return PRAISE_SIGNALS
    .filter((s) => lower.includes(s))
    .map((s) => {
      const idx = lower.indexOf(s);
      const start = Math.max(0, idx - 20);
      const end = Math.min(text.length, idx + s.length + 30);
      return text.slice(start, end).trim();
    })
    .slice(0, 5);
}

function extractCompetitorMentions(text: string): string[] {
  const lower = text.toLowerCase();
  return COMPETITOR_NAMES.filter((c) => lower.includes(c));
}

function extractThemes(text: string): string[] {
  const lower = text.toLowerCase();
  return RECOVERY_THEMES
    .filter((t) => t.signals.some((s) => lower.includes(s)))
    .map((t) => t.theme);
}

function buildReviewKey(platform: string, appSlug: string, reviewId: string): string {
  return createHash('sha256')
    .update(`review:${platform}:${appSlug}:${reviewId}`)
    .digest('hex');
}

// ── iOS App Store RSS feed ────────────────────────────────────────────────────
type IosReview = {
  id: { label: string };
  title: { label: string };
  content: { label: string };
  'im:rating': { label: string };
  'im:voteCount': { label: string };
  author: { name: { label: string } };
  updated: { label: string };
  'im:version'?: { label: string };
};

async function fetchIosReviews(app: AppConfig, page: number = 1): Promise<ReviewRow[]> {
  await rateLimit('appstore');

  const url = `https://itunes.apple.com/us/rss/customerreviews/page=${page}/id=${app.ios_id}/sortby=mostrecent/json`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'recoverystack-review-miner/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[app-reviews] iOS fetch ${res.status} for ${app.name} page ${page}`);
      return [];
    }

    const data = await res.json();
    const entries: IosReview[] = data?.feed?.entry ?? [];

    return entries
      .filter((e) => e?.content?.label && e?.['im:rating']?.label)
      .map((entry): ReviewRow => {
        const body = entry.content.label;
        const rating = Number(entry['im:rating'].label);
        const reviewId = entry.id.label;

        return {
          review_key: buildReviewKey('ios', app.slug, reviewId),
          app_slug: app.slug,
          app_name: app.name,
          platform: 'ios',
          rating,
          title: entry.title.label || null,
          body: body.slice(0, 2000),
          author: entry.author.name.label || null,
          review_date: entry.updated?.label ? new Date(entry.updated.label).toISOString() : null,
          version: entry['im:version']?.label ?? null,
          helpful_count: Number(entry['im:voteCount']?.label ?? 0),
          sentiment: classifySentiment(body, rating),
          pain_points: extractPainPoints(body),
          praised_features: extractPraisedFeatures(body),
          competitor_mentions: extractCompetitorMentions(body),
          themes: extractThemes(body),
          beat: app.beat,
          fetched_at: new Date().toISOString(),
        };
      });
  } catch (err) {
    console.warn(`[app-reviews] iOS error for ${app.name}:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Google Play via unofficial gplayapi (public CDN) ─────────────────────────
type PlayReviewItem = {
  id: string;
  userName: string;
  date: string;
  score: number;
  title: string | null;
  text: string;
  thumbsUpCount: number;
  appVersion: string | null;
};

async function fetchPlayReviews(app: AppConfig): Promise<ReviewRow[]> {
  if (!app.play_id) return [];
  await rateLimit('appstore');

  // Use the unofficial public Google Play scraping endpoint
  const url = new URL('https://play.google.com/_/PlayStoreUi/data/batchexecute');
  const f_req = JSON.stringify([[[
    'UsvDTd',
    JSON.stringify([null, [2, null, [40, null, null, null, null, null, null, [app.play_id, 1]]], [1, 1]]),
    null, 'generic',
  ]]]);

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; recoverystack-bot/1.0)',
      },
      body: `f.req=${encodeURIComponent(f_req)}`,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.warn(`[app-reviews] Play fetch ${res.status} for ${app.name}`);
      return [];
    }

    const raw = await res.text();
    // Parse Play Store's batchexecute response format
    const jsonStart = raw.indexOf('[[');
    if (jsonStart === -1) return [];

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(raw.slice(jsonStart));
    } catch {
      return [];
    }

    const reviews: PlayReviewItem[] = [];
    const extracted = extractPlayReviews(parsedData);
    reviews.push(...extracted);

    return reviews.map((r): ReviewRow => ({
      review_key: buildReviewKey('android', app.slug, r.id),
      app_slug: app.slug,
      app_name: app.name,
      platform: 'android',
      rating: r.score,
      title: r.title || null,
      body: r.text.slice(0, 2000),
      author: r.userName || null,
      review_date: r.date ? new Date(r.date).toISOString() : null,
      version: r.appVersion || null,
      helpful_count: r.thumbsUpCount,
      sentiment: classifySentiment(r.text, r.score),
      pain_points: extractPainPoints(r.text),
      praised_features: extractPraisedFeatures(r.text),
      competitor_mentions: extractCompetitorMentions(r.text),
      themes: extractThemes(r.text),
      beat: app.beat,
      fetched_at: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn(`[app-reviews] Play error for ${app.name}:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

function extractPlayReviews(data: unknown): PlayReviewItem[] {
  if (!Array.isArray(data)) return [];
  const results: PlayReviewItem[] = [];

  function walk(node: unknown): void {
    if (!Array.isArray(node)) return;
    // Play review structure: [reviewId, null, null, author, null, body, score, ...]
    if (
      node.length > 6 &&
      typeof node[0] === 'string' &&
      node[0].length > 10 &&
      typeof node[6] === 'number' &&
      node[6] >= 1 && node[6] <= 5
    ) {
      results.push({
        id: String(node[0]),
        userName: String(node[1]?.[0] ?? ''),
        date: String(node[5]?.[0] ?? ''),
        score: Number(node[6]),
        title: typeof node[3] === 'string' ? node[3] : null,
        text: typeof node[4] === 'string' ? node[4] : '',
        thumbsUpCount: Number(node[10] ?? 0),
        appVersion: typeof node[16] === 'string' ? node[16] : null,
      });
    }
    for (const child of node) walk(child);
  }

  walk(data);
  return results.slice(0, 50);
}

// ── Aggregate reviews per app into sentiment summary ──────────────────────────
async function aggregateAndEnrichBriefs(reviews: ReviewRow[]): Promise<void> {
  const byApp = new Map<string, ReviewRow[]>();
  for (const r of reviews) {
    const arr = byApp.get(r.app_slug) ?? [];
    arr.push(r);
    byApp.set(r.app_slug, arr);
  }

  for (const [slug, appReviews] of byApp) {
    const avgRating = appReviews.reduce((s, r) => s + r.rating, 0) / appReviews.length;
    const positiveCount = appReviews.filter((r) => r.sentiment === 'positive').length;
    const negativeCount = appReviews.filter((r) => r.sentiment === 'negative').length;

    // Aggregate pain points and praised features by frequency
    const painCount = new Map<string, number>();
    const praiseCount = new Map<string, number>();
    const themeCount = new Map<string, number>();

    for (const r of appReviews) {
      for (const p of r.pain_points) painCount.set(p, (painCount.get(p) ?? 0) + 1);
      for (const p of r.praised_features) praiseCount.set(p, (praiseCount.get(p) ?? 0) + 1);
      for (const t of r.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
    }

    const topPainPoints = [...painCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([text]) => text);

    const topPraisedFeatures = [...praiseCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([text]) => text);

    const topThemes = [...themeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([theme]) => theme);

    const competitorMentions = [...new Set(appReviews.flatMap((r) => r.competitor_mentions))];

    const aggregate = {
      app_slug: slug,
      review_count: appReviews.length,
      avg_rating: Math.round(avgRating * 10) / 10,
      positive_pct: Math.round((positiveCount / appReviews.length) * 100),
      negative_pct: Math.round((negativeCount / appReviews.length) * 100),
      top_pain_points: topPainPoints,
      top_praised_features: topPraisedFeatures,
      top_themes: topThemes,
      competitor_mentions: competitorMentions,
      aggregated_at: new Date().toISOString(),
    };

    if (!DRY_RUN) {
      await supabase
        .from('app_review_aggregates')
        .upsert(aggregate, { onConflict: 'app_slug' });
    }

    // Update matching pages' briefs with product sentiment
    const { data: matchingPages } = await supabase
      .from('pages')
      .select('slug')
      .or(`primary_keyword.ilike.%${slug}%,slug.ilike.%${slug}%`);

    if (DRY_RUN) continue;

    for (const page of (matchingPages ?? []) as Array<{ slug: string }>) {
      await supabase
        .from('briefs')
        .update({
          product_sentiment: {
            app_slug: slug,
            avg_rating: aggregate.avg_rating,
            positive_pct: aggregate.positive_pct,
            top_pain_points: aggregate.top_pain_points,
            top_praised_features: aggregate.top_praised_features,
            top_themes: aggregate.top_themes,
          },
        })
        .eq('page_slug', page.slug);
    }
  }
}

async function run(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  // Check which apps were recently scraped
  const { data: recentData } = await supabase
    .from('app_reviews')
    .select('app_slug')
    .gte('fetched_at', cutoff);
  const recentApps = new Set((recentData ?? []).map((r: any) => String(r.app_slug)));

  const allReviews: ReviewRow[] = [];

  for (const app of TARGET_APPS) {
    if (recentApps.has(app.slug)) {
      console.log(`[app-reviews] ${app.name}: recently scraped, skipping`);
      continue;
    }

    const [iosReviews, playReviews] = await Promise.all([
      fetchIosReviews(app, 1),
      fetchPlayReviews(app),
    ]);

    const combined = [...iosReviews, ...playReviews].slice(0, 50);
    allReviews.push(...combined);

    console.log(`[app-reviews] ${app.name}: ios=${iosReviews.length} android=${playReviews.length}`);

    if (allReviews.length >= LIMIT) break;
  }

  console.log(`[app-reviews] Total: ${allReviews.length} reviews (dryRun=${DRY_RUN})`);

  if (!DRY_RUN) {
    let saved = 0;
    // Batch upsert in chunks of 50
    for (let i = 0; i < allReviews.length; i += 50) {
      const chunk = allReviews.slice(i, i + 50);
      const { error } = await supabase
        .from('app_reviews')
        .upsert(chunk, { onConflict: 'review_key' });
      if (error) console.warn(`[app-reviews] DB write error:`, error.message);
      else saved += chunk.length;
    }
    console.log(`[app-reviews] Saved ${saved} reviews`);
  }

  await aggregateAndEnrichBriefs(allReviews);

  console.log('[app-reviews] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
