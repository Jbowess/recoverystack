import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const brandTerms = (process.env.BRANDED_SEARCH_TERMS ?? 'recoverystack,volo ring').split(',').map((term) => term.trim().toLowerCase()).filter(Boolean);
  const [assetsResult, metricsResult, outreachResult, creatorResult, conversionsResult, gscResult] = await Promise.all([
    supabase.from('distribution_assets').select('channel,asset_type,payload').limit(2000),
    supabase.from('social_channel_metrics').select('followers_gained,shares,comments,clicks,conversions').gte('metric_date', today).limit(2000),
    supabase.from('outreach_reply_log').select('target_slug,reply_status').limit(500),
    supabase.from('creator_relationships').select('relationship_stage').limit(200),
    supabase.from('page_conversion_aggregates').select('conversion_count').limit(500),
    supabase.from('gsc_query_rows').select('query,impressions,clicks').gte('date', since).limit(5000),
  ]);

  const assets = assetsResult.error?.message?.includes('distribution_assets') ? [] : (assetsResult.data ?? []);
  const metrics = metricsResult.error?.message?.includes('social_channel_metrics') ? [] : (metricsResult.data ?? []);
  const outreach = outreachResult.error?.message?.includes('outreach_reply_log') ? [] : (outreachResult.data ?? []);
  const creators = creatorResult.error?.message?.includes('creator_relationships') ? [] : (creatorResult.data ?? []);
  const conversions = conversionsResult.error?.message?.includes('page_conversion_aggregates') ? [] : (conversionsResult.data ?? []);
  const gscRows = gscResult.error?.message?.includes('gsc_query_rows') ? [] : (gscResult.data ?? []);

  const newsletterAssets = assets.filter((row: any) => row.channel === 'newsletter').length;
  const reachAssets = assets.filter((row: any) => ['x', 'linkedin', 'instagram', 'facebook', 'reddit', 'short_video'].includes(row.channel)).length;
  const totalAssets = assets.length;
  const creatorMentions = creators.filter((row: any) => ['responded', 'active'].includes(row.relationship_stage)).length;
  const pressMentions = outreach.filter((row: any) => row.target_slug && String(row.target_slug).includes('press')).length;
  const outreachWins = outreach.filter((row: any) => row.reply_status === 'won').length;
  const totalConversions = conversions.reduce((sum: number, row: any) => sum + (row.conversion_count ?? 0), 0);
  const brandedQueries = gscRows.filter((row: any) => brandTerms.some((term) => String(row.query ?? '').toLowerCase().includes(term)));
  const brandedQueryImpressions = brandedQueries.reduce((sum: number, row: any) => sum + Number(row.impressions ?? 0), 0);
  const brandedQueryClicks = brandedQueries.reduce((sum: number, row: any) => sum + Number(row.clicks ?? 0), 0);
  const brandedSearchScore =
    (metrics.reduce((sum: number, row: any) => sum + (row.followers_gained ?? 0), 0) * 2)
    + (creatorMentions * 8)
    + (pressMentions * 6)
    + (outreachWins * 10)
    + Math.round(totalConversions / 2)
    + Math.round(brandedQueryImpressions / 25)
    + Math.round(brandedQueryClicks / 5);

  const payload = {
    snapshot_date: today,
    branded_search_score: brandedSearchScore,
    creator_mentions: creatorMentions,
    press_mentions: pressMentions,
    outreach_wins: outreachWins,
    newsletter_assets: newsletterAssets,
    reach_assets: reachAssets,
    total_assets: totalAssets,
    conversions: totalConversions,
    branded_query_impressions: brandedQueryImpressions,
    branded_query_clicks: brandedQueryClicks,
    metadata: {
      social_clicks: metrics.reduce((sum: number, row: any) => sum + (row.clicks ?? 0), 0),
      social_shares: metrics.reduce((sum: number, row: any) => sum + (row.shares ?? 0), 0),
      social_comments: metrics.reduce((sum: number, row: any) => sum + (row.comments ?? 0), 0),
      branded_search_terms: brandTerms,
    },
  };

  if (DRY_RUN) {
    console.log(`[brand-reach-rollup] ${JSON.stringify(payload)}`);
    return;
  }

  const { error } = await supabase.from('brand_reach_snapshots').upsert(payload, { onConflict: 'snapshot_date' });
  if (error?.message?.includes('brand_reach_snapshots')) {
    console.log('[brand-reach-rollup] brand_reach_snapshots missing - skipping persistence.');
    return;
  }
  if (error) throw error;

  console.log(`[brand-reach-rollup] snapshot_date=${today} branded_search_score=${brandedSearchScore}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
