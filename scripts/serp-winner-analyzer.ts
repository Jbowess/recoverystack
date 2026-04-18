import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PageRow = {
  id: string;
  slug: string;
  template: string;
  beat?: string | null;
  primary_keyword?: string | null;
  body_json: Record<string, unknown> | null;
};

function inferIntent(keyword: string | null | undefined) {
  const value = (keyword ?? '').toLowerCase();
  if (/\b(vs|alternative|best|review|price|worth it|compare)\b/.test(value)) return 'commercial';
  if (/\b(how|why|what|guide|protocol)\b/.test(value)) return 'informational';
  return 'informational';
}

async function run() {
  const [pagesResult, qualityResult] = await Promise.all([
    supabase
      .from('pages')
      .select('id,slug,template,beat,primary_keyword,body_json')
      .eq('status', 'published')
      .limit(1000),
    supabase
      .from('page_quality_scores')
      .select('page_id,total_score')
      .eq('score_type', 'seo_quality')
      .limit(2000),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  if (qualityResult.error) throw qualityResult.error;

  const qualityByPage = new Map((qualityResult.data ?? []).map((row: any) => [String(row.page_id), Number(row.total_score ?? 0)]));
  const buckets = new Map<string, { template: string; beat: string; intent: string; count: number; scoreSum: number; sectionCount: number; faqCount: number; referenceCount: number }>();

  for (const page of (pagesResult.data ?? []) as PageRow[]) {
    const intent = inferIntent(page.primary_keyword);
    const beat = page.beat ?? 'general_recovery';
    const key = `${page.template}::${intent}::${beat}`;
    const body = page.body_json ?? {};
    const current = buckets.get(key) ?? {
      template: page.template,
      beat,
      intent,
      count: 0,
      scoreSum: 0,
      sectionCount: 0,
      faqCount: 0,
      referenceCount: 0,
    };

    current.count += 1;
    current.scoreSum += qualityByPage.get(page.id) ?? 50;
    current.sectionCount += Array.isArray(body.sections) ? body.sections.length : 0;
    current.faqCount += Array.isArray(body.faqs) ? body.faqs.length : 0;
    current.referenceCount += Array.isArray(body.references) ? body.references.length : 0;
    buckets.set(key, current);
  }

  const rows = [...buckets.values()].map((bucket) => ({
    template: bucket.template,
    query_intent: bucket.intent,
    beat: bucket.beat,
    computed_at: new Date().toISOString(),
    metrics: {
      page_count: bucket.count,
      avg_quality_score: Number((bucket.scoreSum / Math.max(bucket.count, 1)).toFixed(2)),
      avg_section_count: Number((bucket.sectionCount / Math.max(bucket.count, 1)).toFixed(2)),
      avg_faq_count: Number((bucket.faqCount / Math.max(bucket.count, 1)).toFixed(2)),
      avg_reference_count: Number((bucket.referenceCount / Math.max(bucket.count, 1)).toFixed(2)),
    },
    patterns: {
      winning_signals: [
        bucket.faqCount / Math.max(bucket.count, 1) >= 3 ? 'faq-heavy' : 'faq-light',
        bucket.referenceCount / Math.max(bucket.count, 1) >= 4 ? 'reference-rich' : 'reference-light',
        bucket.sectionCount / Math.max(bucket.count, 1) >= 6 ? 'deep-structure' : 'compact-structure',
      ],
    },
  }));

  if (rows.length) {
    const { error } = await supabase.from('serp_winner_patterns').upsert(rows, {
      onConflict: 'template,query_intent,beat',
    });
    if (error) throw error;
  }

  console.log(`[serp-winner-analyzer] patterns=${rows.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
