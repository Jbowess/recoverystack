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
    .from('distribution_assets')
    .select('id,page_id,page_slug,channel,asset_type,title,summary,payload,status')
    .in('channel', ['instagram', 'short_video', 'linkedin'])
    .limit(120);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[media-pack-generator] distribution_assets missing - skipping.');
    return;
  }
  if (error) throw error;

  let generated = 0;
  for (const row of (data ?? []) as Array<any>) {
    const assetType = row.channel === 'instagram' ? 'visual_brief' : row.channel === 'short_video' ? 'scene_pack' : 'quote_card_pack';
    const angleType = row.payload?.angle_type ? String(row.payload.angle_type) : 'unspecified';
    const persona = row.payload?.persona ? String(row.payload.persona) : 'general';
    const claimType = row.payload?.claim_type ? String(row.payload.claim_type) : 'general';
    const proof = Array.isArray(row.payload?.source_signals) ? String(row.payload.source_signals[0] ?? '') : '';
    const body = [
      `Primary asset: ${row.title ?? row.page_slug}`,
      `Format: ${assetType}`,
      `Summary: ${row.summary ?? ''}`,
      `Angle: ${angleType}`,
      `Persona: ${persona}`,
      `Claim type: ${claimType}`,
      proof ? `Proof point: ${proof}` : 'Proof point: use the strongest claim from the source asset.',
      'Include one strong hook, one comparison frame, and one CTA frame.',
    ].join('\n');

    generated += 1;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('distribution_assets').upsert({
      page_id: row.page_id,
      page_slug: row.page_slug,
      page_template: 'media_pack',
      channel: row.channel,
      asset_type: assetType,
      status: 'draft',
      title: `${row.title ?? row.page_slug} ${assetType}`,
      summary: row.summary ?? null,
      body,
      payload: {
        derived_from_asset_id: row.id,
        derived_from_type: row.asset_type,
        angle_type: angleType,
        persona,
        claim_type: claimType,
      },
    }, {
      onConflict: 'page_id,channel,asset_type',
    });

    if (upsertError) {
      console.warn(`[media-pack-generator] ${row.page_slug}/${row.channel}: ${upsertError.message}`);
    }
  }

  console.log(`[media-pack-generator] generated=${generated} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
