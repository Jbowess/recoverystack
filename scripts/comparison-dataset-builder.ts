import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SMART_RING_ONLY = process.argv.includes('--smart-ring-only');

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

function isSmartRingSpec(item: ProductSpec): boolean {
  return [item.slug, item.brand, item.model, item.product_type]
    .join(' ')
    .toLowerCase()
    .includes('ring');
}

async function storeDataset(datasetKey: string, title: string, beat: string, rows: unknown[], metadata: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[comparison-dataset-builder] dry-run ${datasetKey} rows=${rows.length}`);
    return;
  }

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

  const scopedSpecs = SMART_RING_ONLY ? specs.filter(isSmartRingSpec) : specs;
  if (!scopedSpecs.length) {
    console.log(`[comparison-dataset-builder] no ${SMART_RING_ONLY ? 'smart ring ' : ''}product_specs rows found`);
    return;
  }

  const beat = SMART_RING_ONLY ? 'smart_rings' : 'wearables';
  const prefix = SMART_RING_ONLY ? 'smart-ring-' : '';

  await storeDataset(
    `${prefix}wearable-pricing-index`,
    SMART_RING_ONLY ? 'Smart Ring Pricing Index' : 'Wearable Pricing Index',
    beat,
    scopedSpecs.map((item) => ({
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      product_type: item.product_type,
      price_usd: item.price_usd ?? null,
      subscription_usd: item.subscription_usd ?? null,
      total_year_one_cost_usd: (item.price_usd ?? 0) + ((item.subscription_usd ?? 0) * 12),
    })),
    { description: SMART_RING_ONLY ? 'Current price and subscription tracker for smart rings.' : 'Current price and subscription tracker for recovery wearables.' },
  );

  await storeDataset(
    `${prefix}firmware-change-tracker`,
    SMART_RING_ONLY ? 'Smart Ring Firmware Change Tracker' : 'Firmware Change Tracker',
    beat,
    scopedSpecs
      .filter((item) => item.firmware_version || item.last_firmware_date)
      .map((item) => ({
        slug: item.slug,
        brand: item.brand,
        model: item.model,
        firmware_version: item.firmware_version ?? null,
        last_firmware_date: item.last_firmware_date ?? null,
      })),
    { description: SMART_RING_ONLY ? 'Latest known smart ring firmware versions and change dates.' : 'Latest known firmware versions and change dates.' },
  );

  await storeDataset(
    `${prefix}metric-validation-matrix`,
    SMART_RING_ONLY ? 'Smart Ring Metric Validation Matrix' : 'Metric Validation Matrix',
    beat,
    scopedSpecs.map((item) => ({
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      validated_metrics: item.validated_metrics ?? [],
      metrics_tracked: item.metrics_tracked ?? [],
    })),
    { description: SMART_RING_ONLY ? 'Validated metrics versus tracked metrics across smart rings.' : 'Validated metrics versus tracked metrics across devices.' },
  );

  await storeDataset(
    `${prefix}platform-compatibility-matrix`,
    SMART_RING_ONLY ? 'Smart Ring Platform Compatibility Matrix' : 'Platform Compatibility Matrix',
    beat,
    scopedSpecs.map((item) => ({
      slug: item.slug,
      brand: item.brand,
      model: item.model,
      compatible_platforms: item.compatible_platforms ?? [],
      battery_days: item.battery_days ?? null,
    })),
    { description: SMART_RING_ONLY ? 'Compatibility and battery-life comparison dataset for smart rings.' : 'Compatibility and battery-life comparison dataset.' },
  );

  if (SMART_RING_ONLY) {
    await storeDataset(
      'smart-ring-subscription-value-matrix',
      'Smart Ring Subscription Value Matrix',
      beat,
      scopedSpecs.map((item) => ({
        slug: item.slug,
        brand: item.brand,
        model: item.model,
        hardware_price_usd: item.price_usd ?? null,
        subscription_usd: item.subscription_usd ?? null,
        year_one_cost_usd: (item.price_usd ?? 0) + ((item.subscription_usd ?? 0) * 12),
        subscription_required: (item.subscription_usd ?? 0) > 0,
      })),
      { description: 'Total cost of ownership comparison for smart rings, including recurring subscription burden.' },
    );

    await storeDataset(
      'smart-ring-sensor-and-platform-matrix',
      'Smart Ring Sensor and Platform Matrix',
      beat,
      scopedSpecs.map((item) => ({
        slug: item.slug,
        brand: item.brand,
        model: item.model,
        validated_metrics: item.validated_metrics ?? [],
        metrics_tracked: item.metrics_tracked ?? [],
        compatible_platforms: item.compatible_platforms ?? [],
        battery_days: item.battery_days ?? null,
      })),
      { description: 'Smart ring sensor, metric, compatibility, and battery comparison layer for buyer-intent pages.' },
    );
  }

  console.log(`[comparison-dataset-builder] snapshots stored for ${scopedSpecs.length} ${SMART_RING_ONLY ? 'smart ring ' : ''}products dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
