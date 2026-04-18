import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { CREATOR_RELATIONSHIP_SEEDS } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  let written = 0;
  for (const seed of CREATOR_RELATIONSHIP_SEEDS) {
    written += 1;
    if (DRY_RUN) {
      console.log(`[creator-crm-sync] ${seed.slug} -> ${seed.primary_platform}`);
      continue;
    }

    const { error } = await supabase.from('creator_relationships').upsert({
      ...seed,
      relationship_stage: 'identified',
      metadata: { seeded: true },
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'slug',
    });

    if (error?.message?.includes('creator_relationships')) {
      console.log('[creator-crm-sync] creator_relationships missing - skipping.');
      break;
    }
  }

  console.log(`[creator-crm-sync] written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
