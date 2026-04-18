import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PERSONAS = [
  {
    persona: 'athletes',
    angle: 'What changes training, recovery, and performance right now.',
  },
  {
    persona: 'biohackers',
    angle: 'What this means for self-tracking, experimentation, and optimization.',
  },
  {
    persona: 'clinicians',
    angle: 'What is evidence-backed, what is uncertain, and what needs caution.',
  },
  {
    persona: 'consumers',
    angle: 'What matters before buying, subscribing, or changing habits.',
  },
];

type PageRow = {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  template: string;
  beat: string | null;
};

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,title,meta_description,template,beat')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(80);

  if (error) throw error;

  let generated = 0;
  for (const page of (data ?? []) as PageRow[]) {
    for (const persona of PERSONAS) {
      const payload = {
        subject: `${page.title} for ${persona.persona}`,
        hook: `${page.title}. ${persona.angle}`,
        summary: page.meta_description ?? `RecoveryStack coverage for ${page.beat ?? 'recovery technology'}.`,
        cta: page.template === 'news' ? `Read the full news analysis at /news/${page.slug}` : `Read the full guide at /${page.template}/${page.slug}`,
        beat: page.beat,
      };

      const { error: upsertError } = await supabase.from('persona_distribution_queue').upsert(
        {
          page_id: page.id,
          page_slug: page.slug,
          channel: 'newsletter',
          persona: persona.persona,
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
