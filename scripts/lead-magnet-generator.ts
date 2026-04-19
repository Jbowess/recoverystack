import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { LEAD_MAGNET_SEEDS, inferAudienceSegment } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const pagesResult = await supabase
    .from('pages')
    .select('id,slug,title,template,primary_keyword,meta_description')
    .eq('status', 'published')
    .limit(120);

  if (pagesResult.error) throw pagesResult.error;
  const pages = pagesResult.data ?? [];

  let offersWritten = 0;
  let assetsWritten = 0;

  for (const offer of LEAD_MAGNET_SEEDS) {
    offersWritten += 1;
    if (!DRY_RUN) {
      const { error } = await supabase.from('lead_magnet_offers').upsert({
        slug: offer.slug,
        title: offer.title,
        format: offer.format,
        target_segment: offer.target_segment,
        primary_cta: offer.primary_cta,
        destination_url: offer.destination_url,
        status: 'active',
        metadata: offer.metadata ?? {},
      }, { onConflict: 'slug' });
      if (error?.message?.includes('lead_magnet_offers')) {
        console.log('[lead-magnet-generator] lead_magnet_offers missing - skipping offer persistence.');
        break;
      }
      if (error) throw error;
    }
  }

  for (const page of pages as any[]) {
    const segment = inferAudienceSegment(`${page.title} ${page.primary_keyword ?? ''} ${page.meta_description ?? ''}`);
    const offer = LEAD_MAGNET_SEEDS.find((item) => item.target_segment === segment) ?? LEAD_MAGNET_SEEDS[0];
    assetsWritten += 1;

    if (DRY_RUN) continue;

    const { error } = await supabase.from('distribution_assets').upsert({
      page_id: page.id,
      page_slug: page.slug,
      page_template: page.template,
      channel: 'newsletter',
      asset_type: 'lead_magnet_pitch',
      status: 'draft',
      title: `${page.title} lead magnet pitch`,
      hook: offer.primary_cta,
      summary: `Lead magnet aligned to ${segment} from ${page.title}.`,
      body: [
        offer.primary_cta,
        `Source page: ${page.title}`,
        `Target segment: ${segment}`,
        `Destination: ${offer.destination_url}`,
      ].join('\n\n'),
      cta_label: offer.primary_cta,
      cta_url: offer.destination_url,
      payload: {
        target_segment: segment,
        lead_magnet_slug: offer.slug,
        format: offer.format,
      },
      source_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
    }, { onConflict: 'page_id,channel,asset_type' });

    if (error?.message?.includes('distribution_assets')) {
      console.log('[lead-magnet-generator] distribution_assets missing - skipping asset persistence.');
      break;
    }
    if (error) throw error;
  }

  console.log(`[lead-magnet-generator] offers=${offersWritten} assets=${assetsWritten} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
