import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { AUDIENCE_SEGMENT_SEEDS, inferAudienceSegment } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const metadataProbe = await supabase.from('pages').select('metadata').limit(1);
  const supportsPageMetadata = !metadataProbe.error;
  let seedWrites = 0;
  for (const seed of AUDIENCE_SEGMENT_SEEDS) {
    seedWrites += 1;
    if (!DRY_RUN) {
      const { error } = await supabase.from('audience_segments').upsert({
        slug: seed.slug,
        label: seed.label,
        description: seed.description,
        buyer_traits: seed.buyer_traits,
        keywords: seed.keywords,
        preferred_ctas: seed.preferred_ctas,
        content_angles: seed.content_angles,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slug' });
      if (error?.message?.includes('audience_segments')) {
        console.log('[audience-segment-sync] audience_segments missing - skipping seed persistence.');
        break;
      }
    }
  }

  const pages = await supabase.from('pages').select('id,slug,title,primary_keyword,metadata').in('status', ['draft', 'published']).limit(200);
  if (pages.error?.message?.includes('metadata')) {
    const legacyPages = await supabase.from('pages').select('id,slug,title,primary_keyword').in('status', ['draft', 'published']).limit(200);
    if (legacyPages.error) throw legacyPages.error;

    let pageUpdates = 0;
    for (const page of (legacyPages.data ?? []) as Array<any>) {
      inferAudienceSegment(`${page.title ?? ''} ${page.primary_keyword ?? ''}`);
      pageUpdates += 1;
    }
    console.log(`[audience-segment-sync] seeds=${seedWrites} pageUpdates=${pageUpdates} metadataSupported=false dryRun=${DRY_RUN}`);
    return;
  }
  if (pages.error) throw pages.error;

  let pageUpdates = 0;
  for (const page of (pages.data ?? []) as Array<any>) {
    const segment = inferAudienceSegment(`${page.title ?? ''} ${page.primary_keyword ?? ''}`);
    pageUpdates += 1;
    if (DRY_RUN) continue;
    if (!supportsPageMetadata) continue;
    const { error } = await supabase.from('pages').update({
      metadata: {
        ...(page.metadata ?? {}),
        audience_segment: segment,
      },
    }).eq('id', page.id);
    if (error?.message?.includes('metadata')) {
      console.log('[audience-segment-sync] pages.metadata missing - stopping page metadata writes.');
      break;
    }
  }

  console.log(`[audience-segment-sync] seeds=${seedWrites} pageUpdates=${pageUpdates} metadataSupported=${supportsPageMetadata} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
