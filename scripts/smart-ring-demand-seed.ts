import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { SMART_RING_MONEY_KEYWORDS } from '@/lib/market-focus';
import { normalizeKeyword, toLegacyCompatibleQueueTemplateId } from '@/lib/seo-keywords';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const timestamp = new Date().toISOString();
  const baseRows = SMART_RING_MONEY_KEYWORDS.map((entry) => ({
    cluster_name: entry.clusterName,
    primary_keyword: entry.keyword,
    template_id: toLegacyCompatibleQueueTemplateId(entry.templateId),
    source: 'evergreen' as const,
    status: 'new',
    priority: entry.priority,
    score: entry.priority / 100,
    metadata: {
      market_focus: 'smart_ring',
      demand_seed: true,
      seeded_at: timestamp,
      execution_priority: 'tier_1',
      desired_template_id: entry.templateId,
    },
  }));

  const rowsWithNormalized = baseRows.map((entry) => ({
    ...entry,
    normalized_keyword: normalizeKeyword(entry.primary_keyword),
  }));

  if (isDryRun) {
    console.log(`[smart-ring-demand-seed] dry-run rows=${rowsWithNormalized.length}`);
    for (const row of rowsWithNormalized) {
      console.log(`  ${row.primary_keyword} -> ${row.template_id} priority=${row.priority}`);
    }
    return;
  }

  const writeRows = async (rows: typeof rowsWithNormalized | typeof baseRows) =>
    supabase.from('keyword_queue').upsert(rows, {
      onConflict: 'cluster_name,primary_keyword',
    });

  let { error } = await writeRows(rowsWithNormalized);
  if (error?.message?.includes('normalized_keyword')) {
    console.warn('[smart-ring-demand-seed] normalized_keyword not available; falling back to legacy keyword_queue schema.');
    ({ error } = await writeRows(baseRows));
  }

  if (error) throw error;

  console.log(`[smart-ring-demand-seed] upserted rows=${baseRows.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
