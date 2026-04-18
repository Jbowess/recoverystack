import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_WATCHLIST_SEEDS } from '@/lib/watchlists';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function run() {
  const { data: entities } = await supabase.from('topic_entities').select('id,slug').eq('active', true);
  const entityBySlug = new Map((entities ?? []).map((row: any) => [String(row.slug), String(row.id)]));

  const rows = DEFAULT_WATCHLIST_SEEDS.map((seed) => ({
    entity_id: seed.entity_slug ? entityBySlug.get(seed.entity_slug) ?? null : null,
    slug: seed.slug,
    label: seed.label,
    watch_type: seed.watch_type,
    beat: seed.beat,
    source_url: seed.source_url ?? null,
    query: seed.query ?? null,
    cadence: seed.cadence,
    priority: seed.priority,
    active: true,
    metadata: seed.metadata ?? {},
  }));

  const { error } = await supabase.from('source_watchlists').upsert(rows, { onConflict: 'slug' });
  if (error) throw error;

  console.log(`[watchlist-sync] watchlists=${rows.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
