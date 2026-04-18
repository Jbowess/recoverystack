import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  const [serpFeatures, competitorAnalyses, reviews, keywordRows] = await Promise.all([
    supabase.from('serp_features').select('keyword,paa_questions,related_searches,featured_snippet_type,recommended_format').limit(200),
    supabase.from('competitor_page_analyses').select('keyword,competitor_domain,required_entities,differentiating_entities').limit(200),
    supabase.from('community_qa').select('source_platform,question,answer_snippet,sentiment,metadata').limit(200),
    supabase.from('keyword_queue').select('primary_keyword,metadata').limit(200),
  ]);

  if (serpFeatures.error && serpFeatures.error.message.includes('serp_snapshot_history')) {
    console.log('[proprietary-data-rollup] source tables unavailable - skipping.');
    return;
  }

  let serpWrites = 0;
  for (const row of (serpFeatures.data ?? []) as Array<any>) {
    const normalized = String(row.keyword ?? '').trim().toLowerCase();
    if (!normalized) continue;
    serpWrites += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase.from('serp_snapshot_history').upsert({
      keyword: row.keyword,
      normalized_keyword: normalized,
      snapshot_date: new Date().toISOString().slice(0, 10),
      source: 'internal_rollup',
      paa_questions: row.paa_questions ?? [],
      related_searches: row.related_searches ?? [],
      features: {
        featured_snippet_type: row.featured_snippet_type ?? null,
        recommended_format: row.recommended_format ?? null,
      },
      metadata: { source_table: 'serp_features' },
    }, {
      onConflict: 'normalized_keyword,snapshot_date,source',
    });
    if (error?.message?.includes('serp_snapshot_history')) {
      console.log('[proprietary-data-rollup] serp_snapshot_history missing - skipping.');
      break;
    }
  }

  let competitorWrites = 0;
  for (const row of (competitorAnalyses.data ?? []) as Array<any>) {
    competitorWrites += 1;
    if (DRY_RUN) continue;
    const domain = String(row.competitor_domain ?? 'unknown').replace(/^https?:\/\//, '');
    const { error } = await supabase.from('competitor_page_snapshots').upsert({
      competitor_slug: domain.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      source_url: `https://${domain}`,
      page_title: row.keyword ?? null,
      page_type: 'serp_competitor',
      keyword: row.keyword ?? null,
      snapshot_date: new Date().toISOString().slice(0, 10),
      summary: `Entities: ${(row.required_entities ?? []).slice(0, 3).join(', ')}`,
      differentiators: row.differentiating_entities ?? [],
      metadata: { source_table: 'competitor_page_analyses' },
    }, {
      onConflict: 'competitor_slug,source_url,snapshot_date',
    });
    if (error?.message?.includes('competitor_page_snapshots')) {
      console.log('[proprietary-data-rollup] competitor_page_snapshots missing - skipping.');
      break;
    }
  }

  let communityWrites = 0;
  for (const row of (reviews.data ?? []) as Array<any>) {
    communityWrites += 1;
    if (DRY_RUN) continue;
    const question = String(row.question ?? '');
    const metadata = row.metadata ?? {};
    const { error } = await supabase.from('community_topic_mentions').insert({
      source_platform: row.source_platform ?? 'unknown',
      source_url: typeof metadata.url === 'string' ? metadata.url : null,
      topic_slug: question.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) || 'general',
      title: question,
      sentiment: row.sentiment ?? null,
      pain_points: typeof metadata.pain_points?.length === 'number' ? metadata.pain_points : [],
      desired_outcomes: typeof metadata.desired_outcomes?.length === 'number' ? metadata.desired_outcomes : [],
      metadata: { answer_snippet: row.answer_snippet ?? null },
    });
    if (error?.message?.includes('community_topic_mentions')) {
      console.log('[proprietary-data-rollup] community_topic_mentions missing - skipping.');
      break;
    }
  }

  console.log(`[proprietary-data-rollup] serp=${serpWrites} competitor=${competitorWrites} community=${communityWrites} keywords=${(keywordRows.data ?? []).length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
