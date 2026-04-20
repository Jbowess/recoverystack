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
    .select('page_id,page_slug,page_template,title,summary,payload')
    .not('payload->>recurring_series', 'is', null)
    .limit(200);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[series-generator] distribution_assets missing - skipping.');
    return;
  }
  if (error) throw error;

  let written = 0;
  for (const row of (data ?? []) as any[]) {
    const series = String(row.payload?.recurring_series ?? 'series');
    const rows = [
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: row.page_template,
        channel: 'newsletter',
        asset_type: 'series_snapshot',
        status: 'draft',
        title: `${series.replace(/_/g, ' ')} snapshot`,
        hook: row.title ?? row.page_slug,
        summary: row.summary ?? null,
        body: [`Series: ${series.replace(/_/g, ' ')}`, `Source: ${row.title ?? row.page_slug}`, row.summary ?? ''].join('\n\n'),
        payload: { recurring_series: series, series_role: 'digest_snapshot', source_payload: row.payload ?? {} },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: row.page_template,
        channel: 'bluesky',
        asset_type: 'series_hot_take',
        status: 'approved',
        title: `${series.replace(/_/g, ' ')} hot take`,
        hook: row.hook ?? row.title ?? row.page_slug,
        summary: 'Series-first reach post for Bluesky.',
        body: [row.hook ?? row.title ?? row.page_slug, row.summary ?? '', 'This is part of the RecoveryStack recurring series.'].filter(Boolean).join('\n\n'),
        payload: { recurring_series: series, series_role: 'hot_take', recurring_series_label: series.replace(/_/g, ' '), source_payload: row.payload ?? {} },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: row.page_template,
        channel: 'reddit',
        asset_type: 'series_commentary',
        status: 'draft',
        title: `${series.replace(/_/g, ' ')} commentary`,
        hook: `Series check: ${row.title ?? row.page_slug}`,
        summary: 'Community-safe recurring series version.',
        body: [`Part of an ongoing RecoveryStack series: ${series.replace(/_/g, ' ')}.`, row.summary ?? '', 'What would you add or challenge?'].join('\n\n'),
        payload: { recurring_series: series, series_role: 'community_series', subreddit_candidates: ['r/wearables', 'r/QuantifiedSelf'], source_payload: row.payload ?? {} },
      },
      {
        page_id: row.page_id,
        page_slug: row.page_slug,
        page_template: row.page_template,
        channel: 'short_video',
        asset_type: 'series_video_script',
        status: 'approved',
        title: `${series.replace(/_/g, ' ')} video script`,
        hook: row.hook ?? row.title ?? row.page_slug,
        summary: 'Series-first short video script.',
        body: [`0-3s: ${row.hook ?? row.title ?? row.page_slug}`, `4-10s: ${row.summary ?? ''}`, '11-18s: Repeat the series thesis.', '19-25s: Send people to the full page.'].join('\n'),
        payload: { recurring_series: series, series_role: 'video_series', source_payload: row.payload ?? {} },
      },
    ];

    written += rows.length;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, { onConflict: 'page_id,channel,asset_type' });
    if (upsertError?.message?.includes('distribution_assets')) {
      console.log('[series-generator] distribution_assets missing - skipping persistence.');
      break;
    }
    if (upsertError) throw upsertError;
  }

  console.log(`[series-generator] generated=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
