import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { runPublishGuards } from '@/lib/publish-guards';
import { checkContentUniqueness, storeContentFingerprint } from '@/lib/content-uniqueness';
import { assessOriginality, buildOriginalityPeer, collectPageText, persistOriginalityAssessment } from '@/lib/originality-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id,slug,status,template,title,h1,meta_description,intro,body_json,schema_org,internal_links,primary_keyword,secondary_keywords,metadata')
    .in('status', ['published', 'approved']);

  if (error) {
    throw new Error(`Unable to load pages for quality gate: ${error.message}`);
  }

  const failures: Array<{ id: string; slug: string; template: string | null; errors: string[] }> = [];
  let passed = 0;
  const peers = (pages ?? []).map((page) => buildOriginalityPeer(page as any));

  for (const page of pages ?? []) {
    const errors = runPublishGuards(page);
    const allText = collectPageText(page as any);
    const originality = assessOriginality(page as any, peers);

    const uniqueness = await checkContentUniqueness(
      page.slug,
      allText,
      page.title ?? '',
      page.primary_keyword ?? null,
    );
    if (uniqueness.isDuplicate) {
      errors.push(
        `near-duplicate content: ${Math.round((uniqueness.similarity ?? 0) * 100)}% similar to "${uniqueness.closestSlug}"`,
      );
    }

    if (originality.status === 'fail') {
      errors.push(
        `originality gate failed: score=${originality.totalScore}; ${originality.failReasons.join('; ')}`,
      );
    }

    try {
      await persistOriginalityAssessment(supabase as any, page as any, originality);
    } catch (persistError) {
      console.warn(
        `[quality-gate] originality persistence failed for ${page.slug}: ${
          persistError instanceof Error ? persistError.message : String(persistError)
        }`,
      );
    }

    if (errors.length) {
      failures.push({ id: page.id, slug: page.slug, template: page.template ?? null, errors });
    } else {
      // Store fingerprint for future uniqueness checks
      await storeContentFingerprint(
        page.id,
        page.slug,
        page.template ?? 'unknown',
        allText,
        page.title ?? '',
        page.primary_keyword ?? null,
      );
      passed++;
    }
  }

  if (failures.length) {
    console.error(`Quality gate failed for ${failures.length} page(s):`);
    failures.forEach((failure, index) => {
      console.error(`\n[${index + 1}/${failures.length}] ${failure.slug} (template=${failure.template ?? 'unknown'}, id=${failure.id})`);
      failure.errors.forEach((err) => {
        console.error(`  • ${err}`);
      });
    });
    process.exit(1);
  }

  console.log(`Quality gate: ${passed} passed, ${failures.length} failed out of ${(pages ?? []).length} page(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
