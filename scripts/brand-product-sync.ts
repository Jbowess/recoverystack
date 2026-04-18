import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

const PRODUCT_ROW = {
  name: PRODUCT_NAME,
  brand: 'RecoveryStack',
  price_aud: null,
  battery_days: 6,
  subscription_required: false,
  unique_features: [
    'Recovery-first smart ring positioning',
    'Sleep and readiness context',
    'Smart-ring form factor for all-day wear',
    'Designed for fitness technology buyers',
  ],
  affiliate_url: PRODUCT_DESTINATION_URL,
  last_scraped: new Date().toISOString(),
};

async function run() {
  if (DRY_RUN) {
    console.log(`[brand-product-sync] dry-run upsert ${PRODUCT_ROW.name} -> ${PRODUCT_ROW.affiliate_url}`);
    return;
  }

  const { error } = await supabase.from('products').upsert(PRODUCT_ROW, { onConflict: 'name' });
  if (error) throw error;

  console.log(`[brand-product-sync] upserted product: ${PRODUCT_ROW.name}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
