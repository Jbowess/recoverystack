import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  buildEventClusteringKey,
  buildStorylineSlug,
  buildStorylineTitle,
  calculateTokenOverlap,
  computeSignificanceScore,
  tokenizeStorylineText,
} from '@/lib/newsroom';
import type { NewsSourceEvent, TopicEntity } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type StorylineCandidate = NewsSourceEvent & {
  entities: TopicEntity[];
  clustering_key?: string | null;
};

type ExistingStoryline = {
  id: string;
  slug: string;
  title: string;
  beat: string;
  storyline_type: string;
  status: string;
  canonical_entity_id: string | null;
  lead_event_id: string | null;
  latest_event_at: string | null;
  authority_score: number;
  freshness_score: number;
  update_count: number;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  clustering_key: string | null;
};

async function loadCandidates(): Promise<StorylineCandidate[]> {
  const { data, error } = await supabase
    .from('news_source_events')
    .select(`
      id,
      title,
      summary,
      url,
      source_type,
      source_domain,
      published_at,
      event_type,
      relevance_score,
      authority_score,
      freshness_score,
      significance_score,
      beat,
      extraction,
      metadata,
      clustering_key,
      news_event_entities (
        topic_entities (
          id,
          slug,
          canonical_name,
          entity_type,
          beat,
          authority_score,
          confidence_score,
          metadata
        )
      )
    `)
    .in('status', ['new', 'ready'])
    .order('published_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source_type: row.source_type,
    source_domain: row.source_domain,
    published_at: row.published_at,
    event_type: row.event_type,
    relevance_score: row.relevance_score,
    authority_score: row.authority_score,
    freshness_score: row.freshness_score,
    significance_score: row.significance_score,
    beat: row.beat,
    extraction: row.extraction ?? {},
    metadata: row.metadata ?? {},
    clustering_key: row.clustering_key,
    entities: (row.news_event_entities ?? [])
      .map((item: any) => item.topic_entities)
      .filter(Boolean),
  }));
}

async function loadExistingStorylines(): Promise<ExistingStoryline[]> {
  const { data, error } = await supabase
    .from('storylines')
    .select('id,slug,title,beat,storyline_type,status,canonical_entity_id,lead_event_id,latest_event_at,authority_score,freshness_score,update_count,summary,metadata,clustering_key')
    .order('latest_event_at', { ascending: false })
    .limit(300);

  if (error) throw error;
  return (data ?? []) as ExistingStoryline[];
}

function determineCandidateKey(candidate: StorylineCandidate) {
  return candidate.clustering_key ?? buildEventClusteringKey(candidate, candidate.entities);
}

function scoreStorylineMatch(candidate: StorylineCandidate, storyline: ExistingStoryline): number {
  const candidateEntityId = candidate.entities[0]?.id ?? null;
  const candidateTokens = tokenizeStorylineText(`${candidate.title} ${candidate.summary ?? ''}`);
  const storylineTokens = tokenizeStorylineText(`${storyline.title} ${storyline.summary ?? ''}`);
  const overlap = calculateTokenOverlap(candidateTokens, storylineTokens);

  let score = overlap * 100;
  if (candidateEntityId && storyline.canonical_entity_id === candidateEntityId) score += 45;
  if (candidate.beat === storyline.beat) score += 12;
  if (candidate.event_type === storyline.storyline_type) score += 12;
  if (storyline.clustering_key && storyline.clustering_key === determineCandidateKey(candidate)) score += 35;

  const candidateTime = new Date(candidate.published_at ?? Date.now()).getTime();
  const storylineTime = new Date(storyline.latest_event_at ?? 0).getTime();
  const ageHours = Math.abs(candidateTime - storylineTime) / (1000 * 60 * 60);
  if (ageHours <= 72) score += 10;
  else if (ageHours > 24 * 30) score -= 20;

  return score;
}

function pickMatchingStoryline(candidate: StorylineCandidate, storylines: ExistingStoryline[]) {
  let best: ExistingStoryline | null = null;
  let bestScore = 0;

  for (const storyline of storylines) {
    const score = scoreStorylineMatch(candidate, storyline);
    if (score > bestScore) {
      best = storyline;
      bestScore = score;
    }
  }

  return bestScore >= 62 ? best : null;
}

function mergeSourceEventIds(existing: unknown, eventId: string): string[] {
  const current = Array.isArray(existing) ? existing.map((item) => String(item)) : [];
  if (!current.includes(eventId)) current.push(eventId);
  return current.slice(-30);
}

async function upsertStoryline(candidate: StorylineCandidate, storylines: ExistingStoryline[]) {
  const existing = pickMatchingStoryline(candidate, storylines);
  const canonicalEntity = candidate.entities[0] ?? null;
  const significanceScore = candidate.significance_score ?? computeSignificanceScore(candidate);
  const candidateKey = determineCandidateKey(candidate);

  const slug = existing?.slug ?? buildStorylineSlug(candidate, candidate.entities);
  const title = existing?.title ?? buildStorylineTitle(candidate, candidate.entities);
  const summary = candidate.summary ?? candidate.title;

  const mergedMetadata = {
    ...(existing?.metadata ?? {}),
    lead_source_domain: existing?.metadata?.lead_source_domain ?? candidate.source_domain,
    source_event_ids: mergeSourceEventIds(existing?.metadata?.source_event_ids, candidate.id),
    source_domains: Array.from(
      new Set([
        ...((Array.isArray(existing?.metadata?.source_domains) ? existing?.metadata?.source_domains : []) as unknown[]).map(String),
        candidate.source_domain ?? '',
      ].filter(Boolean)),
    ),
    source_categories: Array.from(
      new Set([
        ...((Array.isArray(existing?.metadata?.source_categories) ? existing?.metadata?.source_categories : []) as unknown[]).map(String),
        typeof candidate.metadata?.source_category === 'string' ? candidate.metadata.source_category : '',
      ].filter(Boolean)),
    ),
    latest_claims: Array.isArray(candidate.extraction?.key_claims)
      ? candidate.extraction.key_claims.map((item) => String(item)).slice(0, 5)
      : [],
  };

  const updateCount = existing ? existing.update_count + 1 : 1;
  const latestEventAt = candidate.published_at ?? new Date().toISOString();

  const { data, error } = await supabase
    .from('storylines')
    .upsert(
      {
        ...(existing ? { id: existing.id } : {}),
        slug,
        title,
        normalized_title: title.toLowerCase(),
        beat: canonicalEntity?.beat ?? candidate.beat,
        storyline_type: existing?.storyline_type ?? candidate.event_type,
        status: candidate.freshness_score >= 80 ? 'active' : 'monitoring',
        canonical_entity_id: existing?.canonical_entity_id ?? canonicalEntity?.id ?? null,
        lead_event_id: existing?.lead_event_id ?? candidate.id,
        latest_event_at: latestEventAt,
        authority_score: Math.max(existing?.authority_score ?? 0, candidate.authority_score),
        freshness_score: Math.max(existing?.freshness_score ?? 0, candidate.freshness_score),
        update_count: updateCount,
        summary,
        clustering_key: candidateKey,
        metadata: mergedMetadata,
      },
      existing ? { onConflict: 'id' } : { onConflict: 'slug' },
    )
    .select('id,slug,canonical_entity_id,update_count,metadata,lead_event_id')
    .single();

  if (error || !data) throw error;

  const eventOrder = Math.max(0, updateCount - 1);
  await supabase.from('storyline_events').upsert(
    {
      storyline_id: data.id,
      event_id: candidate.id,
      event_order: eventOrder,
      significance_score: significanceScore,
      is_primary: data.lead_event_id === candidate.id,
    },
    { onConflict: 'storyline_id,event_id' },
  );

  await supabase
    .from('news_source_events')
    .update({
      status: 'clustered',
      clustering_key: candidateKey,
      metadata: {
        ...(candidate.metadata ?? {}),
        storyline_slug: data.slug,
        storyline_id: data.id,
        storyline_match: existing ? 'merged' : 'new',
      },
    })
    .eq('id', candidate.id);

  const cachedIndex = storylines.findIndex((item) => item.id === data.id);
  const nextStoryline: ExistingStoryline = {
    id: data.id,
    slug: data.slug,
    title,
    beat: canonicalEntity?.beat ?? candidate.beat,
    storyline_type: existing?.storyline_type ?? candidate.event_type,
    status: candidate.freshness_score >= 80 ? 'active' : 'monitoring',
    canonical_entity_id: data.canonical_entity_id ?? canonicalEntity?.id ?? null,
    lead_event_id: data.lead_event_id ?? candidate.id,
    latest_event_at: latestEventAt,
    authority_score: Math.max(existing?.authority_score ?? 0, candidate.authority_score),
    freshness_score: Math.max(existing?.freshness_score ?? 0, candidate.freshness_score),
    update_count: updateCount,
    summary,
    metadata: mergedMetadata,
    clustering_key: candidateKey,
  };

  if (cachedIndex >= 0) storylines[cachedIndex] = nextStoryline;
  else storylines.unshift(nextStoryline);
}

async function run() {
  const [candidates, storylines] = await Promise.all([
    loadCandidates(),
    loadExistingStorylines(),
  ]);

  let processed = 0;
  for (const candidate of candidates) {
    await upsertStoryline(candidate, storylines);
    processed += 1;
  }

  console.log(`[storyline-builder] processed ${processed} source events into storylines`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
