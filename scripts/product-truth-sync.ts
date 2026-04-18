import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { PRODUCT_TRUTH_SEEDS } from '@/lib/growth-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  console.log(`[product-truth-sync] syncing ${PRODUCT_TRUTH_SEEDS.length} truth cards (dryRun=${DRY_RUN})`);
  let written = 0;

  for (const seed of PRODUCT_TRUTH_SEEDS) {
    written += 1;
    if (DRY_RUN) {
      console.log(`[product-truth-sync] ${seed.productSlug} -> ${seed.cardType}/${seed.title}`);
      continue;
    }

    const { error } = await supabase.from('product_truth_cards').upsert({
      product_slug: seed.productSlug,
      card_type: seed.cardType,
      title: seed.title,
      body: seed.body,
      priority: seed.priority,
      metadata: seed.metadata ?? {},
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'product_slug,card_type,title',
    });

    if (error) {
      console.warn(`[product-truth-sync] ${seed.productSlug}/${seed.title}: ${error.message}`);
    }
  }

  console.log(`[product-truth-sync] written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
