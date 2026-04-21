import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.LLM_SHARE_LIMIT ?? 1500);

type SimulationRow = {
  channel: string;
  matched_page_slug: string | null;
  confidence_score: number;
  result_status: string;
  metadata?: Record<string, unknown> | null;
};

type PageEntityRow = {
  page_slug: string;
  entity_key: string;
  is_primary: boolean;
};

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const [simResult, entityResult] = await Promise.all([
    supabase
      .from('llm_query_simulations')
      .select('channel,matched_page_slug,confidence_score,result_status,metadata')
      .eq('simulated_date', today)
      .limit(LIMIT),
    supabase
      .from('page_entities')
      .select('page_slug,entity_key,is_primary')
      .limit(LIMIT),
  ]);

  if (simResult.error) throw simResult.error;
  if (entityResult.error) throw entityResult.error;

  const entityByPage = new Map<string, string[]>();
  for (const row of (entityResult.data ?? []) as PageEntityRow[]) {
    const current = entityByPage.get(row.page_slug) ?? [];
    if (row.is_primary) current.unshift(row.entity_key);
    else current.push(row.entity_key);
    entityByPage.set(row.page_slug, current.filter((item, index, list) => list.indexOf(item) === index));
  }

  const buckets = new Map<string, {
    channel: string;
    entityKey: string;
    pageSlug: string;
    mentionCount: number;
    citationCount: number;
    recommendationCount: number;
    confidenceTotal: number;
    sampleSize: number;
  }>();

  for (const row of (simResult.data ?? []) as SimulationRow[]) {
    const pageSlug = row.matched_page_slug ?? 'unmatched';
    const entityKeys = entityByPage.get(pageSlug) ?? [pageSlug];
    const citationCount = row.result_status === 'weak_candidate' ? 0 : 1;
    const recommendationCount = row.confidence_score >= 75 ? 1 : 0;

    for (const entityKey of entityKeys.slice(0, 2)) {
      const bucketKey = `${row.channel}::${entityKey}::${pageSlug}`;
      const current = buckets.get(bucketKey) ?? {
        channel: row.channel,
        entityKey,
        pageSlug,
        mentionCount: 0,
        citationCount: 0,
        recommendationCount: 0,
        confidenceTotal: 0,
        sampleSize: 0,
      };

      current.mentionCount += 1;
      current.citationCount += citationCount;
      current.recommendationCount += recommendationCount;
      current.confidenceTotal += row.confidence_score;
      current.sampleSize += 1;
      buckets.set(bucketKey, current);
    }
  }

  const rows = [...buckets.values()].map((bucket) => ({
    snapshot_date: today,
    channel: bucket.channel,
    entity_key: bucket.entityKey,
    page_slug: bucket.pageSlug,
    mention_count: bucket.mentionCount,
    citation_count: bucket.citationCount,
    recommendation_count: bucket.recommendationCount,
    avg_confidence: Number((bucket.confidenceTotal / Math.max(bucket.sampleSize, 1)).toFixed(2)),
    metadata: {
      sample_size: bucket.sampleSize,
    },
  }));

  if (DRY_RUN) {
    console.log(`[llm-share] rows=${rows.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('llm_recommendation_share_snapshots').upsert(rows, {
    onConflict: 'snapshot_date,channel,entity_key,page_slug',
  } as never);

  if (error) throw error;
  console.log(`[llm-share] rows=${rows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
