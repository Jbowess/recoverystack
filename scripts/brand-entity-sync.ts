import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { BRAND_ENTITY_SEEDS } from '@/lib/brand-entities';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.BRAND_ENTITY_LIMIT ?? 300);

type PageRow = {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  intro: string | null;
  primary_keyword: string | null;
  body_json: unknown;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function countMatches(text: string, aliases: string[]) {
  return aliases.reduce((count, alias) => {
    const normalized = normalize(alias);
    if (!normalized) return count;
    return text.includes(normalized) ? count + 1 : count;
  }, 0);
}

async function run() {
  const entityIdBySlug = new Map<string, string>();

  for (const seed of BRAND_ENTITY_SEEDS) {
    if (DRY_RUN) {
      console.log(`[brand-entity-sync] seed ${seed.slug}`);
      continue;
    }

    const { data, error } = await supabase
      .from('topic_entities')
      .upsert(
        {
          slug: seed.slug,
          canonical_name: seed.canonicalName,
          entity_type: seed.entityType,
          beat: seed.beat,
          authority_score: seed.authorityScore,
          confidence_score: seed.confidenceScore,
          metadata: {
            aliases: seed.aliases,
            description: seed.description,
            key_facts: seed.keyFacts,
            site_url: seed.siteUrl,
            tags: seed.tags,
            profile_kind: 'brand_entity',
          },
          active: true,
        },
        { onConflict: 'slug' },
      )
      .select('id,slug')
      .single();

    if (error || !data) throw error ?? new Error(`Unable to upsert entity ${seed.slug}`);
    entityIdBySlug.set(seed.slug, data.id);

    const aliases = seed.aliases.map((alias) => ({
      entity_id: data.id,
      alias,
      normalized_alias: normalize(alias),
      alias_type: 'seed',
      confidence_score: seed.confidenceScore,
    }));

    const aliasWrite = await supabase.from('topic_entity_aliases').upsert(aliases, {
      onConflict: 'entity_id,normalized_alias',
    });

    if (aliasWrite.error) throw aliasWrite.error;
  }

  const { data: pages, error: pageError } = await supabase
    .from('pages')
    .select('id,slug,title,meta_description,intro,primary_keyword,body_json')
    .in('status', ['draft', 'approved', 'published'])
    .order('updated_at', { ascending: false })
    .limit(LIMIT);

  if (pageError) throw pageError;

  if (!DRY_RUN) {
    const cleanup = await supabase.from('page_entities').delete().in('entity_key', BRAND_ENTITY_SEEDS.map((seed) => seed.slug));
    if (cleanup.error) throw cleanup.error;
  }

  let entityLinks = 0;

  for (const page of (pages ?? []) as PageRow[]) {
    const haystack = normalize([
      page.title,
      page.meta_description ?? '',
      page.intro ?? '',
      page.primary_keyword ?? '',
      JSON.stringify(page.body_json ?? {}),
    ].join(' '));

    const matches = BRAND_ENTITY_SEEDS
      .map((seed) => {
        const aliasHits = countMatches(haystack, [seed.canonicalName, ...seed.aliases]);
        if (aliasHits === 0) return null;
        const titlePrimary = countMatches(normalize(`${page.title} ${page.primary_keyword ?? ''}`), [seed.canonicalName, ...seed.aliases]) > 0;
        return {
          seed,
          aliasHits,
          salience: Math.min(98, 62 + aliasHits * 10 + (titlePrimary ? 16 : 0)),
          isPrimary: titlePrimary,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (!matches.length) continue;

    entityLinks += matches.length;

    if (DRY_RUN) {
      console.log(`[brand-entity-sync] ${page.slug} -> ${matches.map((match) => match.seed.slug).join(', ')}`);
      continue;
    }

    const rows = matches.map((match) => ({
      page_id: page.id,
      page_slug: page.slug,
      entity_key: match.seed.slug,
      entity_name: match.seed.canonicalName,
      entity_type: match.seed.entityType,
      salience_score: match.salience,
      is_primary: match.isPrimary,
      metadata: {
        source: 'brand-entity-sync',
        profile_kind: 'brand_entity',
        site_url: match.seed.siteUrl,
      },
    }));

    const write = await supabase.from('page_entities').upsert(rows, {
      onConflict: 'page_id,entity_key',
    });

    if (write.error) throw write.error;
  }

  console.log(`[brand-entity-sync] seeds=${BRAND_ENTITY_SEEDS.length} linked=${entityLinks} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
