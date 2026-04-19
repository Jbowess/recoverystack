import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildPersonaDistributionPayloads, isDistributablePage, type DistributionPageInput } from '@/lib/distribution-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PageRow = {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  template: string;
  beat: string | null;
  intro: string | null;
  primary_keyword: string | null;
  body_json: DistributionPageInput['body_json'];
  metadata: Record<string, unknown> | null;
};

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,title,meta_description,template,beat,intro,primary_keyword,body_json,metadata')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(80);

  if (error) throw error;

  let generated = 0;
  for (const page of (data ?? []) as PageRow[]) {
    if (!isDistributablePage(page as DistributionPageInput)) continue;

    for (const variant of buildPersonaDistributionPayloads(page as DistributionPageInput)) {
      const payload = {
        ...variant.payload,
        beat: page.beat,
      };

      const { error: upsertError } = await supabase.from('persona_distribution_queue').upsert(
        {
          page_id: page.id,
          page_slug: page.slug,
          channel: 'newsletter',
          persona: variant.persona,
          status: 'draft',
          payload,
        },
        { onConflict: 'page_id,channel,persona' },
      );

      if (!upsertError) generated += 1;
    }
  }

  console.log(`[persona-distributor] variants=${generated}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
