import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [conversions, distributionMetrics] = await Promise.all([
    supabase.from('page_conversion_aggregates').select('page_slug,total_revenue_usd,conversion_count,cta_click_count').limit(1000),
    supabase.from('distribution_asset_metrics').select('asset_id,clicks,conversions').limit(1000),
  ]);

  if (conversions.error) throw conversions.error;
  if (distributionMetrics.error?.message?.includes('distribution_asset_metrics')) {
    console.log('[journey-attribution-rollup] distribution_asset_metrics missing - partial attribution only.');
  } else if (distributionMetrics.error) {
    throw distributionMetrics.error;
  }

  const rows = (conversions.data ?? []) as Array<any>;
  let experimentsWritten = 0;

  for (const row of rows) {
    if ((row.cta_click_count ?? 0) < 5) continue;
    const payload = {
      page_slug: row.page_slug,
      experiment_type: 'cta_path',
      variant_a: 'newsletter_first',
      variant_b: 'product_first',
      target_metric: 'conversion_count',
      status: 'draft',
      confidence_score: null,
      metadata: {
        observed_cta_click_count: row.cta_click_count,
        observed_conversion_count: row.conversion_count,
        observed_revenue_usd: row.total_revenue_usd,
      },
    };

    experimentsWritten += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase.from('conversion_experiments').upsert(payload, {
      onConflict: 'page_slug,experiment_type',
    } as any);
    if (error?.message?.includes('conversion_experiments')) {
      console.log('[journey-attribution-rollup] conversion_experiments missing - skipping persistence.');
      break;
    }
  }

  console.log(`[journey-attribution-rollup] candidate_experiments=${experimentsWritten} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
