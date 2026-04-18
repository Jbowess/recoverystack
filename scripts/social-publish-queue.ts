import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildPublicationQueueRecord, type DistributionAssetRow } from '@/lib/growth-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.SOCIAL_PUBLISH_QUEUE_LIMIT ?? 80);

async function run() {
  const { data, error } = await supabase
    .from('distribution_assets')
    .select('id,page_id,page_slug,channel,asset_type,title,hook,summary,body,cta_url,payload,status')
    .in('status', ['draft', 'approved'])
    .in('channel', ['x', 'linkedin', 'instagram', 'facebook', 'reddit', 'short_video', 'newsletter'])
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[social-publish-queue] distribution_assets missing - skipping until migration is applied.');
    return;
  }
  if (error) throw error;
  const assets = (data ?? []) as Array<DistributionAssetRow & { status?: string }>;

  let queued = 0;
  for (const asset of assets) {
    const row = buildPublicationQueueRecord(asset);
    queued += 1;

    if (DRY_RUN) {
      console.log(`[social-publish-queue] ${asset.page_slug} -> ${asset.channel} @ ${row.scheduled_for}`);
      continue;
    }

    const { error: upsertError } = await supabase.from('channel_publication_queue').upsert(row, {
      onConflict: 'distribution_asset_id,channel',
    });

    if (upsertError) {
      console.warn(`[social-publish-queue] ${asset.page_slug}/${asset.channel}: ${upsertError.message}`);
    }
  }

  console.log(`[social-publish-queue] assets=${assets.length} queued=${queued} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
