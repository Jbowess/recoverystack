import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [snapshotsResult, pagesResult] = await Promise.all([
    supabase.from('comparison_dataset_snapshots').select('dataset_key,title,snapshot_date,row_count,metadata').order('snapshot_date', { ascending: false }).limit(20),
    supabase.from('pages').select('id,slug,title,template').eq('status', 'published').limit(80),
  ]);

  if (snapshotsResult.error?.message?.includes('comparison_dataset_snapshots')) {
    console.log('[press-data-brief-generator] comparison_dataset_snapshots missing - skipping.');
    return;
  }
  if (snapshotsResult.error) throw snapshotsResult.error;
  if (pagesResult.error) throw pagesResult.error;

  let written = 0;
  for (const snapshot of (snapshotsResult.data ?? []) as any[]) {
    const relatedPage = (pagesResult.data ?? []).find((page: any) => snapshot.title.toLowerCase().includes(String(page.slug).replace(/-/g, ' '))) ?? (pagesResult.data ?? [])[0];
    if (!relatedPage) continue;

    written += 1;
    if (DRY_RUN) continue;

    const { error } = await supabase.from('distribution_assets').upsert({
      page_id: relatedPage.id,
      page_slug: relatedPage.slug,
      page_template: relatedPage.template,
      channel: 'affiliate_outreach',
      asset_type: 'press_data_brief',
      status: 'draft',
      title: `${snapshot.title} press data brief`,
      hook: `${snapshot.title} is a pressable data angle.`,
      summary: `Dataset ${snapshot.dataset_key} with ${snapshot.row_count} rows updated ${snapshot.snapshot_date}.`,
      body: [
        `Headline angle: ${snapshot.title}`,
        `Dataset key: ${snapshot.dataset_key}`,
        `Rows: ${snapshot.row_count}`,
        `Updated: ${snapshot.snapshot_date}`,
      ].join('\n\n'),
      payload: {
        dataset_key: snapshot.dataset_key,
        row_count: snapshot.row_count,
        snapshot_date: snapshot.snapshot_date,
        press_ready: true,
      },
      source_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${relatedPage.template}/${relatedPage.slug}`,
    }, { onConflict: 'page_id,channel,asset_type' });

    if (error?.message?.includes('distribution_assets')) {
      console.log('[press-data-brief-generator] distribution_assets missing - skipping persistence.');
      break;
    }
    if (error) throw error;
  }

  console.log(`[press-data-brief-generator] written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
