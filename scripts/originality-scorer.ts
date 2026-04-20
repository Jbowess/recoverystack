import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { assessOriginality, buildOriginalityPeer, persistOriginalityAssessment } from '@/lib/originality-system';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id,slug,status,template,title,h1,intro,body_json,primary_keyword,secondary_keywords,metadata')
    .in('status', ['published', 'approved'])
    .limit(400);

  if (error) throw error;
  if (!pages?.length) {
    console.log('[originality-scorer] no pages found');
    return;
  }

  const peers = pages.map((page) => buildOriginalityPeer(page as any));
  let wrote = 0;

  for (const page of pages) {
    const assessment = assessOriginality(page as any, peers);
    await persistOriginalityAssessment(supabase as any, page as any, assessment);
    wrote += 1;
    console.log(
      `[originality-scorer] ${page.slug}: score=${assessment.totalScore} status=${assessment.status} nearest=${assessment.nearestMatch.slug ?? 'none'} similarity=${assessment.nearestMatch.similarity}`,
    );
  }

  console.log(`[originality-scorer] scored ${wrote} page(s)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
