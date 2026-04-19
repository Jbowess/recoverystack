import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const { data, error } = await supabase
    .from('distribution_assets')
    .select('id,page_id,page_slug,title,hook,summary,payload')
    .eq('channel', 'short_video')
    .in('asset_type', ['short_script', 'objection_script'])
    .limit(120);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[video-package-generator] distribution_assets missing - skipping.');
    return;
  }
  if (error) throw error;

  let written = 0;
  for (const row of (data ?? []) as any[]) {
    const base = row.title ?? row.page_slug;
    const proof = Array.isArray(row.payload?.source_signals) ? String(row.payload.source_signals[0] ?? row.summary ?? '') : String(row.summary ?? '');
    const rows = [
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'thumbnail_hook_pack',
        status: 'draft',
        title: `${base} thumbnail hooks`,
        summary: 'Thumbnail/title hook pack for short-form and YouTube.',
        body: [`Hook 1: ${row.hook}`, `Hook 2: ${proof}`, `Hook 3: ${base}`].join('\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'thumbnail_hooks' },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'long_form_outline',
        status: 'draft',
        title: `${base} long-form outline`,
        summary: 'Long-form outline for YouTube or podcast adaptation.',
        body: ['Intro hook', String(row.hook ?? ''), 'Main proof', proof, 'Counterargument', String(row.payload?.strongest_objection ?? ''), 'CTA', 'Point people to the full article.'].join('\n\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'long_form_outline' },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'youtube_seo_pack',
        status: 'draft',
        title: `${base} YouTube SEO pack`,
        summary: 'YouTube title/description pack.',
        body: [`Title: ${base}`, `Description: ${row.summary ?? ''}`, `CTA: Link to full article.`].join('\n\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'youtube_seo_pack' },
      },
    ];

    written += rows.length;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, { onConflict: 'page_id,channel,asset_type' });
    if (upsertError?.message?.includes('distribution_assets')) {
      console.log('[video-package-generator] distribution_assets missing - skipping persistence.');
      break;
    }
    if (upsertError) throw upsertError;
  }

  console.log(`[video-package-generator] generated=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
