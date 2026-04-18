import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ENTITY_SEEDS, extractEntityMatches } from '@/lib/newsroom';
import type { TopicEntity } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type EventRow = {
  id: string;
  title: string;
  summary: string | null;
  beat: string;
  source_domain?: string | null;
  extraction?: Record<string, unknown> | null;
};

async function seedEntities() {
  for (const entity of ENTITY_SEEDS) {
    const { data, error } = await supabase
      .from('topic_entities')
      .upsert(
        {
          slug: entity.slug,
          canonical_name: entity.canonical_name,
          entity_type: entity.entity_type,
          beat: entity.beat,
          authority_score: 70,
          confidence_score: 90,
          metadata: { aliases: entity.aliases, ...(entity.site_url ? { site_url: entity.site_url } : {}) },
        },
        { onConflict: 'slug' },
      )
      .select('id,slug,canonical_name,entity_type,beat,authority_score,confidence_score,metadata')
      .single();

    if (error || !data) continue;

    const aliasRows = entity.aliases.map((alias) => ({
      entity_id: data.id,
      alias,
      normalized_alias: alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
      alias_type: 'seed',
      confidence_score: 90,
    }));

    await supabase.from('topic_entity_aliases').upsert(aliasRows, {
      onConflict: 'entity_id,normalized_alias',
    });
  }
}

async function run() {
  await seedEntities();

  const [{ data: entities }, { data: events }] = await Promise.all([
    supabase
      .from('topic_entities')
      .select('id,slug,canonical_name,entity_type,beat,authority_score,confidence_score,metadata')
      .eq('active', true),
    supabase
      .from('news_source_events')
      .select('id,title,summary,beat,source_domain,extraction')
      .in('status', ['new', 'ready'])
      .order('published_at', { ascending: false })
      .limit(200),
  ]);

  const typedEntities = (entities ?? []) as TopicEntity[];
  let linksCreated = 0;

  for (const event of (events ?? []) as EventRow[]) {
    const extractedText = typeof event.extraction?.extracted_text === 'string' ? event.extraction.extracted_text : '';
    const matches = extractEntityMatches(`${event.title} ${event.summary ?? ''} ${extractedText}`, typedEntities);
    const inferredDomainMatches = typedEntities.filter((entity) => {
      const siteUrl = typeof entity.metadata?.site_url === 'string' ? entity.metadata.site_url : null;
      if (!siteUrl || !event.source_domain) return false;
      try {
        const domain = new URL(siteUrl).hostname.replace(/^www\./, '');
        return domain === event.source_domain;
      } catch {
        return false;
      }
    });
    const allMatches = [...matches, ...inferredDomainMatches].filter(
      (match, index, list) => list.findIndex((item) => item.id === match.id) === index,
    );
    if (!allMatches.length) continue;

    const rows = allMatches.map((match) => ({
      event_id: event.id,
      entity_id: match.id,
      relationship_type: inferredDomainMatches.some((item) => item.id === match.id) ? 'primary_subject' : 'mentions',
      confidence_score: Math.max(60, match.confidence_score),
    }));

    const { error } = await supabase.from('news_event_entities').upsert(rows, {
      onConflict: 'event_id,entity_id,relationship_type',
    });

    if (!error) linksCreated += rows.length;
  }

  console.log(`[entity-sync] linked ${linksCreated} event-entity relationships`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
