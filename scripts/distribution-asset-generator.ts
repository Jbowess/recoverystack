import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildDistributionAssets, isDistributablePage, type DistributionPageInput } from '@/lib/distribution-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.DISTRIBUTION_ASSET_LIMIT ?? 50);

async function loadPublishedPages(limit: number) {
  const modern = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,metadata,published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (modern.error?.message?.includes('metadata')) {
    const legacy = await supabase
      .from('pages')
      .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []).map((row) => ({ ...row, metadata: null }));
  }

  if (modern.error) throw modern.error;
  return modern.data ?? [];
}

async function run() {
  const pages = (await loadPublishedPages(LIMIT) as DistributionPageInput[]).filter(isDistributablePage);
  let assetCount = 0;

  for (const page of pages) {
    const assets = buildDistributionAssets(page);
    assetCount += assets.length;

    if (DRY_RUN) {
      for (const asset of assets) {
        console.log(`[distribution-asset-generator] ${page.slug} -> ${asset.channel}/${asset.assetType}`);
      }
      continue;
    }

    const rows = assets.map((asset) => ({
      page_id: page.id,
      page_slug: page.slug,
      page_template: page.template,
      channel: asset.channel,
      asset_type: asset.assetType,
      status: 'draft',
      title: asset.title,
      hook: asset.hook,
      summary: asset.summary,
      body: asset.body,
      cta_label: asset.ctaLabel,
      cta_url: asset.ctaUrl,
      hashtags: asset.hashtags,
      payload: asset.payload,
      source_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
    }));

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, {
      onConflict: 'page_id,channel,asset_type',
    });

    if (upsertError) {
      console.warn(`[distribution-asset-generator] ${page.slug}: ${upsertError.message}`);
    }
  }

  console.log(`[distribution-asset-generator] pages=${pages.length} assets=${assetCount} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
