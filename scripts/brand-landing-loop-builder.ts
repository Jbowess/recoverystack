import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { pickReachThesis } from '@/lib/reach-theses';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function trim(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,title,primary_keyword,meta_description,metadata')
    .eq('status', 'published')
    .limit(220);

  if (error) throw error;

  const pages = (data ?? []) as any[];
  let updated = 0;
  for (const page of pages) {
    const thesis = pickReachThesis({
      title: page.title,
      primaryKeyword: page.primary_keyword,
      template: page.template,
      body: page.meta_description,
    });
    const nextPages = pages
      .filter((candidate) => candidate.slug !== page.slug)
      .filter((candidate) => candidate.template === page.template || trim(candidate.primary_keyword).split(' ')[0] === trim(page.primary_keyword).split(' ')[0])
      .slice(0, 3)
      .map((candidate) => ({
        slug: candidate.slug,
        template: candidate.template,
        title: candidate.title,
      }));

    const metadata = {
      ...(page.metadata ?? {}),
      brand_landing_loop: {
        thesis: thesis.thesis,
        title: 'Why RecoveryStack keeps showing up in the category',
        proof_points: thesis.supportingFrames.slice(0, 3),
        next_steps: nextPages,
        newsletter_pitch: 'Get the ongoing market thesis and buyer context in RecoveryStack News.',
      },
    };

    updated += 1;
    if (DRY_RUN) continue;

    const { error: updateError } = await supabase.from('pages').update({ metadata }).eq('id', page.id);
    if (updateError) throw updateError;
  }

  console.log(`[brand-landing-loop-builder] updated=${updated} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
