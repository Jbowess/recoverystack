import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type EntityRow = {
  id: string;
  canonical_name: string;
};

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: entities, error } = await supabase
    .from('topic_entities')
    .select('id,canonical_name')
    .eq('active', true)
    .order('canonical_name', { ascending: true });

  if (error) throw error;

  let upserts = 0;

  for (const entity of (entities ?? []) as EntityRow[]) {
    const [{ count: eventCount }, { data: storylineRows }] = await Promise.all([
      supabase.from('news_event_entities').select('id', { count: 'exact', head: true }).eq('entity_id', entity.id),
      supabase
        .from('storylines')
        .select('id')
        .eq('canonical_entity_id', entity.id),
    ]);

    const storylineIds = (storylineRows ?? []).map((row: any) => row.id);
    let pageCount = 0;
    let newsPageCount = 0;

    if (storylineIds.length > 0) {
      const [{ count: allPages }, { count: newsPages }] = await Promise.all([
        supabase.from('pages').select('id', { count: 'exact', head: true }).in('storyline_id', storylineIds),
        supabase.from('pages').select('id', { count: 'exact', head: true }).eq('template', 'news').in('storyline_id', storylineIds),
      ]);
      pageCount = allPages ?? 0;
      newsPageCount = newsPages ?? 0;
    }

    const storylineCount = storylineIds.length;

    const authorityScore = Math.min(
      100,
      (eventCount ?? 0) * 4 + storylineCount * 8 + newsPageCount * 10 + pageCount * 3,
    );

    await supabase.from('entity_coverage_daily').upsert(
      {
        entity_id: entity.id,
        date: today,
        page_count: pageCount,
        news_page_count: newsPageCount,
        storyline_count: storylineCount,
        source_event_count: eventCount ?? 0,
        authority_score: authorityScore,
      },
      { onConflict: 'entity_id,date' },
    );

    await supabase.from('topic_entities').update({ authority_score: authorityScore }).eq('id', entity.id);
    upserts += 1;
  }

  console.log(`[authority-rollup] updated ${upserts} entity coverage record(s) for ${today}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
