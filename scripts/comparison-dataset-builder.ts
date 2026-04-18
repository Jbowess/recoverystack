import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ProductSpec = {
  slug: string;
  brand: string;
  model: string;
  product_type: string;
  beat?: string | null;
  price_usd?: number | null;
  subscription_usd?: number | null;
  battery_days?: number | null;
  firmware_version?: string | null;
  last_firmware_date?: string | null;
  validated_metrics?: string[] | null;
  metrics_tracked?: string[] | null;
  compatible_platforms?: string[] | null;
  status?: string | null;
};

async function storeDataset(datasetKey: string, title: string, beat: string, rows: unknown[], metadata: Record<string, unknown>) {
  await supabase.from('comparison_dataset_snapshots').upsert(
    {
      dataset_key: datasetKey,
      title,
      beat,
      snapshot_date: new Date().toISOString().slice(0, 10),
      row_count: rows.length,
      data: rows,
      metadata,
    },
    { onConflict: 'dataset_key,snapshot_date' },
  );
}

async function run() {
  const { data, error } = await supabase
    .from('product_specs')
    .select('slug,brand,model,product_type,price_usd,subscription_usd,battery_days,firmware_version,last_firmware_date,validated_metrics,metrics_tracked,compatible_platforms,status')
    .eq('status', 'active');

  if (error) throw error;

  const specs = (data ?? []) as ProductSpec[];
  if (!specs.length) {
    console.log('[comparison-dataset-builder] no product_specs rows found');
    return;
  }

  await storeDataset(
    'wearable-pricing-index',
    'Wearable Pricing Index',
    'wearables',
    specs.map((item) => ({
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      product_type: item.product_type,
      price_usd: item.price_usd ?? null,
      subscription_usd: item.subscription_usd ?? null,
      total_year_one_cost_usd: (item.price_usd ?? 0) + ((item.subscription_usd ?? 0) * 12),
    })),
    { description: 'Current price and subscription tracker for recovery wearables.' },
  );

  await storeDataset(
    'firmware-change-tracker',
    'Firmware Change Tracker',
    'wearables',
    specs
      .filter((item) => item.firmware_version || item.last_firmware_date)
      .map((item) => ({
        slug: item.slug,
        brand: item.brand,
        model: item.model,
        firmware_version: item.firmware_version ?? null,
        last_firmware_date: item.last_firmware_date ?? null,
      })),
    { description: 'Latest known firmware versions and change dates.' },
  );

  await storeDataset(
    'metric-validation-matrix',
    'Metric Validation Matrix',
    'wearables',
    specs.map((item) => ({
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      validated_metrics: item.validated_metrics ?? [],
      metrics_tracked: item.metrics_tracked ?? [],
    })),
    { description: 'Validated metrics versus tracked metrics across devices.' },
  );

  await storeDataset(
    'platform-compatibility-matrix',
    'Platform Compatibility Matrix',
    'wearables',
    specs.map((item) => ({
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      compatible_platforms: item.compatible_platforms ?? [],
      battery_days: item.battery_days ?? null,
    })),
    { description: 'Compatibility and battery-life comparison dataset.' },
  );

  console.log(`[comparison-dataset-builder] snapshots stored for ${specs.length} products`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
