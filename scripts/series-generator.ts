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
    const asset = {
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
      payload: { recurring_series: series, source_payload: row.payload ?? {} },
    };

    written += 1;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(asset, { onConflict: 'page_id,channel,asset_type' });
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
