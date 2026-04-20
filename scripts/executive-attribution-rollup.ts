import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { computeExecutiveAttributionScores } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const [conversionsResult, socialResult, brandReachResult] = await Promise.all([
    supabase.from('page_conversions').select('utm_source,attribution_model,attribution_weight,revenue_usd').limit(3000),
    supabase.from('social_channel_metrics').select('channel,conversions,engagements,clicks').limit(3000),
    supabase.from('brand_reach_snapshots').select('snapshot_date,creator_mentions,press_mentions').order('snapshot_date', { ascending: false }).limit(30),
  ]);

  if (conversionsResult.error?.message?.includes('page_conversions')) {
    console.log('[executive-attribution-rollup] page_conversions missing - skipping.');
    return;
  }
  if (conversionsResult.error) throw conversionsResult.error;

  const channels = ['seo', 'newsletter', 'x', 'linkedin', 'instagram', 'reddit', 'short_video'];
  const rows = channels.map((channel) => {
    const channelConversions = (conversionsResult.data ?? []).filter((row: any) => {
      const source = String(row.utm_source ?? 'seo').toLowerCase();
      return channel === 'seo' ? !source || source === 'seo' : source === channel;
    });

    const firstTouchRevenue = channelConversions
      .filter((row: any) => String(row.attribution_model ?? 'last_touch') === 'last_touch')
      .reduce((sum: number, row: any) => sum + Number(row.revenue_usd ?? 0) * Number(row.attribution_weight ?? 1), 0);
    const assistedRevenue = channelConversions
      .filter((row: any) => String(row.attribution_model ?? '') !== 'last_touch')
      .reduce((sum: number, row: any) => sum + Number(row.revenue_usd ?? 0) * Number(row.attribution_weight ?? 1), 0);

    const channelSocial = (socialResult.data ?? []).filter((row: any) => row.channel === channel);
    const latestBrandReach = (brandReachResult.data ?? [])[0] as any;

    const scores = computeExecutiveAttributionScores({
      firstTouchRevenue,
      assistedRevenue,
      newsletterAssists: channel === 'newsletter' ? channelSocial.reduce((sum: number, row: any) => sum + Number(row.clicks ?? 0), 0) : 0,
      productAssists: channelSocial.reduce((sum: number, row: any) => sum + Number(row.conversions ?? 0), 0),
      contentInfluenceSignals: channelSocial.map((row: any) => Number(row.engagements ?? 0) + Number(row.clicks ?? 0)),
      creatorInfluenceSignals: [Number(latestBrandReach?.creator_mentions ?? 0) * 8, Number(latestBrandReach?.press_mentions ?? 0) * 6],
    });

    return {
      snapshot_date: today,
      market_slug: 'smart_ring',
      channel,
      ...scores,
      metadata: {
        conversion_rows: channelConversions.length,
        social_rows: channelSocial.length,
      },
    };
  });

  if (DRY_RUN) {
    console.log(`[executive-attribution-rollup] rows=${rows.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('executive_attribution_rollups').upsert(rows, {
    onConflict: 'snapshot_date,market_slug,channel',
  } as never);
  if (error?.message?.includes('executive_attribution_rollups')) {
    console.log('[executive-attribution-rollup] executive_attribution_rollups missing - skipping persistence.');
    return;
  }
  if (error) throw error;

  console.log(`[executive-attribution-rollup] rows=${rows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
