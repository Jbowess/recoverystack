import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { computeMoatScore } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const [
    datasetsResult,
    frameworksResult,
    creatorsResult,
    packetsResult,
    decisionAssetsResult,
  ] = await Promise.all([
    supabase.from('comparison_dataset_snapshots').select('id', { count: 'exact', head: true }),
    supabase.from('brand_frameworks').select('id', { count: 'exact', head: true }),
    supabase.from('creator_relationships').select('id', { count: 'exact', head: true }),
    supabase.from('repurposing_packets').select('id', { count: 'exact', head: true }),
    supabase.from('distribution_assets').select('id', { count: 'exact', head: true }).in('asset_type', ['decision_cards', 'carousel_outline', 'infographic_brief', 'email_brief']),
  ]);

  const payload = {
    snapshot_date: today,
    proprietary_dataset_count: datasetsResult.count ?? 0,
    framework_count: frameworksResult.count ?? 0,
    scoring_model_count: 2,
    creator_relationship_count: creatorsResult.count ?? 0,
    repurposing_packet_count: packetsResult.count ?? 0,
    decision_asset_count: decisionAssetsResult.count ?? 0,
    moat_score: computeMoatScore({
      datasetCount: datasetsResult.count ?? 0,
      frameworkCount: frameworksResult.count ?? 0,
      scoringModelCount: 2,
      creatorRelationshipCount: creatorsResult.count ?? 0,
      packetCount: packetsResult.count ?? 0,
      decisionAssetCount: decisionAssetsResult.count ?? 0,
    }),
    metadata: {},
  };

  if (DRY_RUN) {
    console.log(`[moat-engine-rollup] ${JSON.stringify(payload)}`);
    return;
  }

  const { error } = await supabase.from('brand_moat_snapshots').upsert(payload, { onConflict: 'snapshot_date' });
  if (error?.message?.includes('brand_moat_snapshots')) {
    console.log('[moat-engine-rollup] brand_moat_snapshots missing - skipping persistence.');
    return;
  }
  if (error) throw error;
  console.log(`[moat-engine-rollup] moat_score=${payload.moat_score} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
