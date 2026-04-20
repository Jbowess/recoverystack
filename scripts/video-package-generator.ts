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
    const objection = String(row.payload?.strongest_objection ?? row.summary ?? 'The decision changes when cost, comfort, or signal quality breaks.');
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
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'shot_list',
        status: 'approved',
        title: `${base} shot list`,
        summary: 'Shot list for short-form production.',
        body: ['Shot 1: face-to-camera hook', 'Shot 2: product or article screenshot', `Shot 3: proof overlay - ${proof}`, `Shot 4: objection line - ${objection}`, 'Shot 5: CTA to the full page'].join('\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'shot_list' },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'caption_pack',
        status: 'approved',
        title: `${base} caption pack`,
        summary: 'Caption variants for short-form posting.',
        body: [`Caption A: ${row.hook}`, `Caption B: ${proof}`, `Caption C: ${objection}`].join('\n\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'captions' },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'onscreen_text_pack',
        status: 'approved',
        title: `${base} on-screen text`,
        summary: 'On-screen text and hook overlays.',
        body: [`Overlay 1: ${row.hook}`, `Overlay 2: ${proof}`, `Overlay 3: ${objection}`].join('\n\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'on_screen_text' },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'broll_suggestions',
        status: 'approved',
        title: `${base} b-roll suggestions`,
        summary: 'B-roll and cutaway suggestions.',
        body: ['Phone app close-up', 'Ring macro shot', 'Scorecard graphic', 'Comparison table crop', 'CTA end-frame'].join('\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'broll_suggestions' },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: 'video_package',
        channel: 'short_video',
        asset_type: 'thumbnail_text_pack',
        status: 'approved',
        title: `${base} thumbnail text`,
        summary: 'Thumbnail text for video variants.',
        body: [`Thumb 1: ${base}`, 'Thumb 2: What buyers miss', 'Thumb 3: Avoid this if...'].join('\n'),
        payload: { derived_from_asset_id: row.id, package_type: 'thumbnail_text' },
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
