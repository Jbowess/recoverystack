import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildLeadMagnetOffer, inferAudienceSegment, LEAD_MAGNET_SEEDS } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  let leadMagnetWrites = 0;
  for (const offer of LEAD_MAGNET_SEEDS) {
    leadMagnetWrites += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase.from('lead_magnet_offers').upsert({
      ...offer,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' });
    if (error?.message?.includes('lead_magnet_offers')) {
      console.log('[demand-loop-builder] lead_magnet_offers missing - skipping persistence.');
      break;
    }
  }

  const pages = await supabase.from('pages').select('slug,title,primary_keyword,metadata').eq('status', 'published').limit(100);
  const pageRows = pages.error?.message?.includes('metadata')
    ? await supabase.from('pages').select('slug,title,primary_keyword').eq('status', 'published').limit(100)
    : pages;
  if (pageRows.error) throw pageRows.error;

  let recommended = 0;
  for (const page of (pageRows.data ?? []) as Array<any>) {
    const segment = inferAudienceSegment(`${page.title ?? ''} ${page.primary_keyword ?? ''}`);
    const offer = buildLeadMagnetOffer(segment);
    recommended += 1;
    console.log(`[demand-loop-builder] ${page.slug} -> ${segment} -> ${offer.slug}`);
  }

  console.log(`[demand-loop-builder] leadMagnets=${leadMagnetWrites} recommendations=${recommended} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
