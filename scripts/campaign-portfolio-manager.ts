import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildCampaignKey, computeCampaignMetrics } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [assetsResult, queueResult] = await Promise.all([
    supabase.from('distribution_assets').select('id,page_slug,channel,asset_type,payload').limit(2000),
    supabase.from('channel_publication_queue').select('distribution_asset_id,page_slug,channel,publish_priority,performance_snapshot').limit(2000),
  ]);

  if (assetsResult.error?.message?.includes('distribution_assets')) {
    console.log('[campaign-portfolio-manager] distribution_assets missing - skipping.');
    return;
  }
  if (assetsResult.error) throw assetsResult.error;

  const assets = assetsResult.data ?? [];
  const queueByAsset = new Map((queueResult.data ?? []).map((row: any) => [row.distribution_asset_id, row]));
  const groups = new Map<string, any[]>();

  for (const asset of assets as any[]) {
    const family = String(asset.payload?.campaign_family ?? asset.payload?.recurring_series ?? 'general_campaign');
    const key = buildCampaignKey(asset.page_slug, family);
    const list = groups.get(key) ?? [];
    list.push(asset);
    groups.set(key, list);
  }

  const campaigns = [...groups.entries()].map(([campaignKey, rows]) => {
    const first = rows[0];
    const metrics = computeCampaignMetrics(rows.map((row) => {
      const queue = queueByAsset.get(row.id);
      const reach = Number(row.payload?.reach_score ?? queue?.performance_snapshot?.impressions ?? 0);
      const conversions = Number(queue?.performance_snapshot?.conversions ?? 0);
      const priority = Number(queue?.publish_priority ?? row.payload?.repurposing_score ?? 50);
      return { reach, conversions, priority };
    }));

    return {
      campaign_key: campaignKey,
      title: `${first.page_slug} ${String(first.payload?.campaign_family ?? 'campaign').replace(/_/g, ' ')}`,
      objective: ['newsletter', 'linkedin', 'x'].includes(first.channel) ? 'reach_and_capture' : 'conversion_support',
      market_slug: 'smart_ring',
      channel_mix: Array.from(new Set(rows.map((row: any) => row.channel))),
      expected_reach: metrics.expectedReach,
      expected_conversions: metrics.expectedConversions,
      actual_reach: metrics.actualReach,
      actual_conversions: metrics.actualConversions,
      budget_score: Math.min(99, rows.length * 8),
      status: metrics.actualReach > 0 ? 'active' : 'planned',
      metadata: {
        page_slug: first.page_slug,
        asset_count: rows.length,
      },
    };
  });

  const campaignMapRows = [...groups.entries()].flatMap(([campaignKey, rows]) =>
    rows.map((row: any) => ({
      campaign_key: campaignKey,
      asset_id: row.id,
      page_slug: row.page_slug,
      asset_channel: row.channel,
      asset_type: row.asset_type,
      role: row.channel === 'newsletter' ? 'core' : 'supporting',
      metadata: row.payload ?? {},
    })),
  );

  if (DRY_RUN) {
    console.log(`[campaign-portfolio-manager] campaigns=${campaigns.length} asset_map=${campaignMapRows.length} dryRun=true`);
    return;
  }

  const campaignWrite = await supabase.from('campaign_portfolios').upsert(campaigns, { onConflict: 'campaign_key' });
  if (campaignWrite.error?.message?.includes('campaign_portfolios')) {
    console.log('[campaign-portfolio-manager] campaign_portfolios missing - skipping persistence.');
    return;
  }
  if (campaignWrite.error) throw campaignWrite.error;

  const mapWrite = await supabase.from('campaign_asset_map').upsert(campaignMapRows, {
    onConflict: 'campaign_key,asset_id,page_slug,asset_channel,asset_type',
  } as never);
  if (mapWrite.error?.message?.includes('campaign_asset_map')) {
    console.log('[campaign-portfolio-manager] campaign_asset_map missing - skipping map persistence.');
    return;
  }
  if (mapWrite.error) throw mapWrite.error;

  console.log(`[campaign-portfolio-manager] campaigns=${campaigns.length} asset_map=${campaignMapRows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
