import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { PRODUCT_INTELLIGENCE_CARDS } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  let written = 0;
  for (const card of PRODUCT_INTELLIGENCE_CARDS) {
    written += 1;
    if (DRY_RUN) {
      console.log(`[volo-product-intelligence-sync] ${card.card_type}: ${card.title}`);
      continue;
    }

    const { error } = await supabase.from('product_truth_cards').upsert({
      product_slug: card.product_slug,
      card_type: card.card_type,
      title: card.title,
      body: card.body,
      priority: 84,
      metadata: { source: 'volo-product-intelligence-sync' },
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'product_slug,card_type,title',
    });

    if (error?.message?.includes('product_truth_cards')) {
      console.log('[volo-product-intelligence-sync] product_truth_cards missing - skipping.');
      break;
    }
  }

  console.log(`[volo-product-intelligence-sync] written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
