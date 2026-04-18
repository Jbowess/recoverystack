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
  title: string;
  metadata: Record<string, unknown> | null;
  storyline_id: string | null;
  status: string;
};

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,title,metadata,storyline_id,status')
    .in('status', ['approved', 'published'])
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  let opened = 0;
  for (const page of (data ?? []) as PageRow[]) {
    const meta = page.metadata ?? {};
    const claimStatus = typeof meta.claim_verification_status === 'string' ? meta.claim_verification_status : 'unknown';
    const claimCount = Number(meta.claim_count ?? 0);
    const verifiedCount = Number(meta.verified_claim_count ?? 0);
    const significance = Number(meta.news_significance_score ?? 0);
    const sourceDiversity = Number(meta.source_diversity ?? 0);

    let reviewType: string | null = null;
    let priority = 0;
    let rationale = '';

    if (page.template === 'news' && significance >= 80 && claimStatus !== 'verified') {
      reviewType = 'breaking_news_review';
      priority = 92;
      rationale = 'High-significance news page still lacks full claim verification.';
    } else if (claimCount > 0 && verifiedCount < claimCount) {
      reviewType = 'evidence_review';
      priority = 78;
      rationale = 'Claims are only partially verified and need human evidence review.';
    } else if (page.template === 'reviews' || page.template === 'alternatives') {
      reviewType = 'commercial_editorial_review';
      priority = 70;
      rationale = 'Commercial-intent evaluative page should be manually reviewed before heavy promotion.';
    } else if (sourceDiversity <= 1 && page.template === 'news') {
      reviewType = 'source_diversity_review';
      priority = 68;
      rationale = 'News page appears to rely on a narrow source set.';
    }

    if (!reviewType) continue;

    const { error: upsertError } = await supabase.from('editorial_review_queue').upsert(
      {
        page_id: page.id,
        page_slug: page.slug,
        review_type: reviewType,
        priority,
        status: 'open',
        rationale,
        payload: {
          title: page.title,
          claim_status: claimStatus,
          claim_count: claimCount,
          verified_claim_count: verifiedCount,
          significance_score: significance,
          storyline_id: page.storyline_id,
        },
      },
      { onConflict: 'page_id,review_type,status' },
    );

    if (!upsertError) opened += 1;
  }

  console.log(`[editorial-review-queue] opened_or_refreshed=${opened}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
