import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

type QueueRow = {
  id: string;
  distribution_asset_id: string | null;
  page_slug: string;
  channel: string;
  performance_snapshot: Record<string, unknown> | null;
};

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function run() {
  const queueResult = await supabase
    .from('channel_publication_queue')
    .select('id,distribution_asset_id,page_slug,channel,performance_snapshot')
    .in('publish_status', ['posted', 'approved', 'scheduled'])
    .limit(200);

  if (queueResult.error?.message?.includes('channel_publication_queue')) {
    console.log('[social-metrics-sync] channel_publication_queue missing - skipping until migration is applied.');
    return;
  }
  if (queueResult.error) throw queueResult.error;
  const rows = (queueResult.data ?? []) as QueueRow[];

  let written = 0;
  for (const row of rows) {
    const snapshot = row.performance_snapshot ?? {};
    const metricRow = {
      publication_queue_id: row.id,
      page_slug: row.page_slug,
      channel: row.channel,
      metric_date: new Date().toISOString().slice(0, 10),
      impressions: num(snapshot.impressions),
      clicks: num(snapshot.clicks),
      engagements: num(snapshot.engagements),
      shares: num(snapshot.shares),
      saves: num(snapshot.saves),
      comments: num(snapshot.comments),
      followers_gained: num(snapshot.followers_gained),
      conversions: num(snapshot.conversions),
      revenue_usd: num(snapshot.revenue_usd),
      metadata: {
        source: 'channel_publication_queue.performance_snapshot',
      },
    };

    if (
      metricRow.impressions === 0 &&
      metricRow.clicks === 0 &&
      metricRow.engagements === 0 &&
      metricRow.conversions === 0 &&
      metricRow.revenue_usd === 0
    ) {
      continue;
    }

    written += 1;
    if (DRY_RUN) {
      console.log(`[social-metrics-sync] ${row.page_slug}/${row.channel} impressions=${metricRow.impressions}`);
      continue;
    }

    const { error } = await supabase.from('social_channel_metrics').upsert(metricRow, {
      onConflict: 'publication_queue_id,metric_date',
    });
    if (error) {
      console.warn(`[social-metrics-sync] ${row.page_slug}/${row.channel}: ${error.message}`);
      continue;
    }

    if (!row.distribution_asset_id) {
      continue;
    }

    const { error: metricUpdateError } = await supabase.from('distribution_asset_metrics').upsert({
      asset_id: row.distribution_asset_id,
      metric_date: metricRow.metric_date,
      impressions: metricRow.impressions,
      clicks: metricRow.clicks,
      engagements: metricRow.engagements,
      conversions: metricRow.conversions,
      metadata: { source: 'social_channel_metrics' },
    }, {
      onConflict: 'asset_id,metric_date',
    });

    if (metricUpdateError) {
      console.warn(`[social-metrics-sync] dist-metric ${row.page_slug}/${row.channel}: ${metricUpdateError.message}`);
    }
  }

  console.log(`[social-metrics-sync] queueRows=${rows.length} written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
