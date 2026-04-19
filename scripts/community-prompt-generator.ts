import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,title,primary_keyword,meta_description,metadata')
    .eq('status', 'published')
    .limit(120);

  if (error) throw error;

  let written = 0;
  for (const page of (data ?? []) as any[]) {
    const objection = page.metadata?.strongest_objection ?? page.metadata?.community_signals?.[0] ?? 'what actually matters after the first month';
    const proof = page.metadata?.proof_point ?? page.metadata?.distribution_evidence?.[0] ?? page.meta_description ?? page.title;
    const prompt = `What would you challenge about ${page.primary_keyword ?? page.title}: ${String(objection).toLowerCase()}?`;
    written += 2;

    if (DRY_RUN) continue;

    const rows = [
      {
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'reddit',
        asset_type: 'community_prompt',
        status: 'draft',
        title: `${page.title} community prompt`,
        hook: prompt,
        summary: 'Discussion-first Reddit/community prompt.',
        body: [prompt, `Proof point: ${proof}`, 'What would you add or challenge?'].join('\n\n'),
        cta_label: 'Use as community prompt',
        cta_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
        payload: { prompt_type: 'discussion', source_page_template: page.template, subreddit_candidates: ['smart-ring', 'wearables', 'biohackers'] },
      },
      {
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'facebook',
        asset_type: 'community_prompt',
        status: 'draft',
        title: `${page.title} group prompt`,
        hook: prompt,
        summary: 'Group-native prompt built from page objection and proof.',
        body: [prompt, `Context: ${proof}`].join('\n\n'),
        cta_label: 'Use in community',
        cta_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
        payload: { prompt_type: 'group_discussion', source_page_template: page.template },
      },
    ];

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, { onConflict: 'page_id,channel,asset_type' });
    if (upsertError?.message?.includes('distribution_assets')) {
      console.log('[community-prompt-generator] distribution_assets missing - skipping persistence.');
      break;
    }
    if (upsertError) throw upsertError;
  }

  console.log(`[community-prompt-generator] pages=${data?.length ?? 0} assets=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
