/**
 * news-wave.ts
 *
 * High-velocity news pipeline lane. Runs during the News Wave phase (after
 * news-intake + storyline-builder). Reads high-scoring events from
 * news_source_events, finds events not yet linked to a published page, and
 * enqueues them as `news` template draft pages linked to their storyline.
 *
 * Falls back to trend_observations velocity if news_source_events is empty
 * (e.g. first run before intake has populated the table).
 *
 * Usage:
 *   npx tsx scripts/news-wave.ts
 *   npx tsx scripts/news-wave.ts --dry-run
 *   NEWS_WAVE_MAX=5 npx tsx scripts/news-wave.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '@/lib/slugify';
import { normalizeKeyword } from '@/lib/seo-keywords';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const argv = process.argv.slice(2);
const isDryRun = argv.includes('--dry-run') || process.env.DRY_RUN === '1';

const NEWS_WAVE_MAX = Number(process.env.NEWS_WAVE_MAX ?? 6);
const NEWS_COOLDOWN_DAYS = Number(process.env.NEWS_COOLDOWN_DAYS ?? 7);
const MIN_RELEVANCE_SCORE = Number(process.env.NEWS_MIN_RELEVANCE ?? 60);

// Fallback velocity config (used when news_source_events is empty)
const VELOCITY_WINDOW_H = Number(process.env.NEWS_VELOCITY_WINDOW_H ?? 24);
const VELOCITY_THRESHOLD = Number(process.env.NEWS_VELOCITY_THRESHOLD ?? 2);

type SourceEvent = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source_type: string | null;
  beat: string;
  event_type: string;
  relevance_score: number;
  authority_score: number;
  freshness_score: number;
  significance_score: number;
  published_at: string | null;
  storyline_id: string | null;
  storyline_title: string | null;
  storyline_slug: string | null;
};

async function loadCandidateEvents(): Promise<SourceEvent[]> {
  const windowStart = new Date(Date.now() - VELOCITY_WINDOW_H * 60 * 60 * 1000).toISOString();

  // Primary path: use news_source_events with high relevance scores
  const { data: events, error } = await supabase
    .from('news_source_events')
    .select(`
      id,
      title,
      summary,
      url,
      source_type,
      beat,
      event_type,
      relevance_score,
      authority_score,
      freshness_score,
      significance_score,
      published_at,
      storyline_events (
        storylines (
          id,
          title,
          slug
        )
      )
    `)
    .gte('discovered_at', windowStart)
    .gte('relevance_score', MIN_RELEVANCE_SCORE)
    .in('status', ['new', 'ready'])
    .order('significance_score', { ascending: false })
    .limit(50);

  if (error) {
    console.warn(`[news-wave] news_source_events query failed: ${error.message} — falling back to trend_observations`);
    return loadFallbackFromTrends();
  }

  if (!events?.length) {
    console.log('[news-wave] No qualifying source events found — falling back to trend_observations');
    return loadFallbackFromTrends();
  }

  return (events as any[]).map((e) => {
    const storylineRel = e.storyline_events?.[0]?.storylines;
    return {
      id: e.id,
      title: e.title,
      summary: e.summary,
      url: e.url,
      source_type: e.source_type,
      beat: e.beat,
      event_type: e.event_type,
      relevance_score: e.relevance_score,
      authority_score: e.authority_score,
      freshness_score: e.freshness_score,
      significance_score: e.significance_score ?? e.relevance_score,
      published_at: e.published_at,
      storyline_id: storylineRel?.id ?? null,
      storyline_title: storylineRel?.title ?? null,
      storyline_slug: storylineRel?.slug ?? null,
    };
  });
}

async function loadFallbackFromTrends(): Promise<SourceEvent[]> {
  const windowStart = new Date(Date.now() - VELOCITY_WINDOW_H * 60 * 60 * 1000).toISOString();

  const { data: observations, error } = await supabase
    .from('trend_observations')
    .select('normalized_term, trend_id')
    .gte('observed_at', windowStart);

  if (error || !observations?.length) return [];

  const sightingCounts = new Map<string, { count: number; trendId: string }>();
  for (const obs of observations) {
    const key = String(obs.normalized_term);
    const existing = sightingCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      sightingCounts.set(key, { count: 1, trendId: String(obs.trend_id ?? '') });
    }
  }

  const hotTerms = Array.from(sightingCounts.entries())
    .filter(([, v]) => v.count >= VELOCITY_THRESHOLD)
    .map(([term]) => term);

  if (!hotTerms.length) return [];

  const { data: trends } = await supabase
    .from('trends')
    .select('id, term, normalized_term, trend_score, last_seen_at')
    .in('normalized_term', hotTerms)
    .neq('status', 'blocked')
    .order('trend_score', { ascending: false });

  return (trends ?? []).map((t: any) => ({
    id: `trend:${t.id}`,
    title: String(t.term),
    summary: null,
    url: '',
    source_type: 'trend',
    beat: 'general_recovery',
    event_type: 'trending',
    relevance_score: Number(t.trend_score ?? 50),
    authority_score: 50,
    freshness_score: 70,
    significance_score: Number(t.trend_score ?? 50),
    published_at: t.last_seen_at,
    storyline_id: null,
    storyline_title: null,
    storyline_slug: null,
  }));
}

async function isOnNewsCooldown(primaryKeyword: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - NEWS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('pages')
    .select('id')
    .eq('template', 'news')
    .ilike('primary_keyword', primaryKeyword)
    .gte('last_generated_at', cutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

function deriveNewsFormat(eventType: string): string {
  switch (eventType) {
    case 'product_launch':
    case 'firmware_update':
    case 'company_announcement':
      return 'breaking';
    case 'research_publication':
    case 'study_result':
      return 'research';
    case 'trending':
    case 'roundup':
      return 'roundup';
    case 'expert_statement':
    case 'interview':
      return 'expert_reaction';
    case 'data_release':
    case 'report':
      return 'data_brief';
    default:
      return 'breaking';
  }
}

async function enqueueNewsPage(event: SourceEvent): Promise<boolean> {
  const normalizedKeyword = normalizeKeyword(event.title);
  const onCooldown = await isOnNewsCooldown(normalizedKeyword);
  if (onCooldown) {
    console.log(`[news-wave] Skip (cooldown): "${event.title}"`);
    return false;
  }

  const newsFormat = deriveNewsFormat(event.event_type);
  const slug = slugify(`${event.title}-${newsFormat}`);

  const { data: existing } = await supabase
    .from('pages')
    .select('id')
    .eq('slug', slug)
    .limit(1);

  if (existing?.length) {
    console.log(`[news-wave] Skip (slug exists): "${slug}"`);
    return false;
  }

  const title = event.storyline_title ?? `${event.title.charAt(0).toUpperCase() + event.title.slice(1)}: What You Need to Know`;
  const metaDescription = event.summary
    ? event.summary.slice(0, 155)
    : `Latest on ${event.title} — what it means for recovery, fitness technology, and your training stack.`;

  if (isDryRun) {
    console.log(`[news-wave] DRY RUN — would enqueue: "${title}" beat=${event.beat} format=${newsFormat} relevance=${event.relevance_score}`);
    return true;
  }

  const { error } = await supabase.from('pages').insert({
    slug,
    template: 'news',
    content_type: 'news',
    news_format: newsFormat,
    beat: event.beat,
    title,
    h1: title,
    meta_description: metaDescription,
    primary_keyword: normalizedKeyword,
    status: 'draft',
    ...(event.storyline_id ? { storyline_id: event.storyline_id } : {}),
    ...(event.id.startsWith('trend:') ? {} : { source_event_id: event.id }),
    metadata: {
      news_source_event_id: event.id.startsWith('trend:') ? null : event.id,
      news_event_type: event.event_type,
      news_relevance_score: event.relevance_score,
      news_authority_score: event.authority_score,
      news_freshness_score: event.freshness_score,
      news_significance_score: event.significance_score,
      news_source_type: event.source_type,
      queued_by: 'news-wave',
      source_url: event.url || null,
    },
  });

  if (error) {
    console.error(`[news-wave] Insert failed for "${slug}": ${error.message}`);
    return false;
  }

  console.log(`[news-wave] Enqueued: "${title}" beat=${event.beat} format=${newsFormat}`);
  return true;
}

async function run() {
  console.log(`[news-wave] Starting. max=${NEWS_WAVE_MAX} minRelevance=${MIN_RELEVANCE_SCORE} cooldown=${NEWS_COOLDOWN_DAYS}d dryRun=${isDryRun}`);

  const candidates = await loadCandidateEvents();
  console.log(`[news-wave] Candidates: ${candidates.length}`);

  if (!candidates.length) {
    console.log('[news-wave] Nothing to enqueue.');
    return;
  }

  let enqueued = 0;
  for (const event of candidates) {
    if (enqueued >= NEWS_WAVE_MAX) break;
    const ok = await enqueueNewsPage(event);
    if (ok) enqueued++;
  }

  console.log(`[news-wave] Complete. enqueued=${enqueued} dryRun=${isDryRun}`);
}

run().catch((error) => {
  console.error('[news-wave] Fatal:', error);
  process.exit(1);
});
