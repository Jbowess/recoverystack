import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { CREATOR_RELATIONSHIP_SEEDS } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const { data, error } = await supabase
    .from('distribution_assets')
    .select('page_id,page_slug,title,summary,payload,cta_url')
    .eq('channel', 'affiliate_outreach')
    .eq('asset_type', 'creator_brief')
    .limit(120);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[creator-brief-generator] distribution_assets missing - skipping.');
    return;
  }
  if (error) throw error;

  let queued = 0;
  for (const asset of (data ?? []) as any[]) {
    for (const creator of CREATOR_RELATIONSHIP_SEEDS.filter((row) => ['blog', 'youtube'].includes(row.primary_platform)).slice(0, 3)) {
      queued += 1;
      if (DRY_RUN) continue;

      const thesis = String(asset.payload?.strongest_claim ?? asset.summary ?? 'RecoveryStack turns buyer confusion into a clearer decision.');
      const objection = String(asset.payload?.strongest_objection ?? 'Most buyers still anchor on the wrong decision variable.');

      const { error: upsertError } = await supabase.from('outreach_queue').upsert({
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        channel: 'affiliate_outreach',
        target_name: creator.name,
        target_domain: null,
        target_type: 'creator',
        status: 'draft',
        angle: 'creator_outreach',
        subject: `Creator angle for ${asset.title ?? asset.page_slug}`,
        body: [
          asset.summary ?? '',
          `Core thesis: ${thesis}`,
          `Audience tension: ${objection}`,
          `Creator fit: ${creator.partnership_fit}`,
          `Preferred platform: ${creator.primary_platform}`,
          `CTA: ${asset.cta_url ?? ''}`,
        ].join('\n\n'),
        cta_url: asset.cta_url ?? null,
        metadata: {
          creator_slug: creator.slug,
          audience_segment: creator.audience_segment,
          source_asset_type: 'creator_brief',
          creator_platform: creator.primary_platform,
          reach_focus: 'earned_distribution',
        },
      }, { onConflict: 'page_slug,channel,target_name' });

      if (upsertError?.message?.includes('outreach_queue')) {
        console.log('[creator-brief-generator] outreach_queue missing - skipping persistence.');
        return;
      }
      if (upsertError) throw upsertError;
    }
  }

  console.log(`[creator-brief-generator] queued=${queued} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
