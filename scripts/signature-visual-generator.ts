import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { pickReachThesis } from '@/lib/reach-theses';
import type { RepurposingSourcePack } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,title,primary_keyword,meta_description,body_json')
    .eq('status', 'published')
    .limit(120);

  if (error) throw error;

  let written = 0;
  for (const page of (data ?? []) as any[]) {
    const sourcePack = (page.body_json?.repurposing_source_pack ?? null) as RepurposingSourcePack | null;
    const thesis = pickReachThesis({
      title: page.title,
      primaryKeyword: page.primary_keyword,
      template: page.template,
      body: sourcePack?.primary_thesis ?? page.meta_description,
    });
    const trackedUrl = `${SITE_URL}/${page.template}/${page.slug}`;
    const bestFor = sourcePack?.best_for_split ?? page.meta_description ?? page.title;
    const avoidIf = sourcePack?.avoid_if_split ?? sourcePack?.strongest_objection ?? 'you care more about brand halo than fit';
    const stat = sourcePack?.quoted_stat ?? page.meta_description ?? page.title;

    const rows = [
      {
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'short_video',
        asset_type: 'signature_scorecard_brief',
        status: 'approved',
        title: `${page.title} scorecard brief`,
        hook: thesis.thesis,
        summary: 'RecoveryStack signature scorecard format.',
        body: [`Format: RecoveryStack Score`, `Headline: ${page.title}`, `Thesis: ${thesis.thesis}`, `Best for: ${bestFor}`, `Avoid if: ${avoidIf}`, `CTA: ${trackedUrl}`].join('\n'),
        cta_url: trackedUrl,
        payload: { visual_format: 'scorecard', thesis_slug: thesis.slug },
      },
      {
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'short_video',
        asset_type: 'buyer_warning_card',
        status: 'approved',
        title: `${page.title} buyer warning`,
        hook: `Buyer warning: ${avoidIf}`,
        summary: 'Signature buyer-warning card.',
        body: [`Warning line: ${avoidIf}`, `Support: ${stat}`, `Brand thesis: ${thesis.thesis}`, `CTA: ${trackedUrl}`].join('\n'),
        cta_url: trackedUrl,
        payload: { visual_format: 'buyer_warning', thesis_slug: thesis.slug },
      },
      {
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'short_video',
        asset_type: 'ranking_ladder_brief',
        status: 'approved',
        title: `${page.title} ranking ladder`,
        hook: `Ranking ladder for ${page.title}`,
        summary: 'Signature ranking-ladder visual.',
        body: [`Top rung: ${bestFor}`, `Middle rung: buyer-fit comparison`, `Bottom rung: ${avoidIf}`, `Proof point: ${stat}`].join('\n'),
        cta_url: trackedUrl,
        payload: { visual_format: 'ranking_ladder', thesis_slug: thesis.slug },
      },
      {
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'short_video',
        asset_type: 'subscription_trap_chart',
        status: 'approved',
        title: `${page.title} subscription trap chart`,
        hook: `The cost trap in ${page.title}`,
        summary: 'Signature subscription-trap chart.',
        body: [`Chart title: Subscription burden vs feature count`, `Primary thesis: ${thesis.thesis}`, `Evidence line: ${stat}`, `CTA: ${trackedUrl}`].join('\n'),
        cta_url: trackedUrl,
        payload: { visual_format: 'subscription_trap', thesis_slug: thesis.slug },
      },
    ];

    written += rows.length;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, {
      onConflict: 'page_id,channel,asset_type',
    });
    if (upsertError?.message?.includes('distribution_assets')) {
      console.log('[signature-visual-generator] distribution_assets missing - skipping persistence.');
      return;
    }
    if (upsertError) throw upsertError;
  }

  console.log(`[signature-visual-generator] assets=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
