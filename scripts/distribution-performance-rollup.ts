import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

type AssetRow = {
  id: string;
  page_slug: string;
  channel: string;
  status: string;
  asset_type?: string | null;
  payload?: Record<string, unknown> | null;
};

type ConversionAggRow = {
  page_slug: string;
  conversion_count: number | null;
  cta_click_count: number | null;
};

async function run() {
  const [assetsResult, conversionsResult] = await Promise.all([
    supabase
      .from('distribution_assets')
      .select('id,page_slug,channel,status,asset_type,payload')
      .limit(2000),
    supabase
      .from('page_conversion_aggregates')
      .select('page_slug,conversion_count,cta_click_count')
      .limit(2000),
  ]);

  if (assetsResult.error?.message?.includes('distribution_assets')) {
    console.log('[distribution-performance-rollup] distribution_assets missing - skipping until migration is applied.');
    return;
  }

  if (assetsResult.error) throw assetsResult.error;
  if (conversionsResult.error && !conversionsResult.error.message.includes('page_conversion_aggregates')) {
    throw conversionsResult.error;
  }

  const assets = (assetsResult.data ?? []) as AssetRow[];
  const conversions = (conversionsResult.data ?? []) as ConversionAggRow[];
  const conversionsBySlug = new Map(
    conversions.map((row) => [
      row.page_slug,
      {
        conversions: row.conversion_count ?? 0,
        clicks: row.cta_click_count ?? 0,
      },
    ]),
  );

  const today = new Date().toISOString().slice(0, 10);
  let written = 0;

  for (const asset of assets) {
    const rollup = conversionsBySlug.get(asset.page_slug) ?? { conversions: 0, clicks: 0 };
    if (DRY_RUN) {
      written += 1;
      continue;
    }

    const { error } = await supabase.from('distribution_asset_metrics').upsert({
      asset_id: asset.id,
      metric_date: today,
      impressions: 0,
      clicks: rollup.clicks,
      engagements: asset.status === 'published' ? rollup.clicks : 0,
      conversions: rollup.conversions,
      metadata: {
        rollup_source: 'page_conversion_aggregates',
        asset_channel: asset.channel,
        asset_type: asset.asset_type ?? null,
        angle_type: asset.payload?.angle_type ?? null,
        persona: asset.payload?.persona ?? null,
        claim_type: asset.payload?.claim_type ?? null,
        evidence_type: asset.payload?.evidence_type ?? null,
      },
    }, {
      onConflict: 'asset_id,metric_date',
    });

    if (!error) written += 1;
  }

  console.log(`[distribution-performance-rollup] assets=${assets.length} written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
