import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { runPublishGuards } from '@/lib/publish-guards';
import { checkContentUniqueness, storeContentFingerprint, computeSimhash } from '@/lib/content-uniqueness';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function collectAllText(page: any): string {
  const parts: string[] = [page.title ?? '', page.intro ?? ''];
  const sections = page.body_json?.sections ?? [];
  for (const s of sections) {
    parts.push(s.heading ?? '');
    parts.push(typeof s.content === 'string' ? s.content : JSON.stringify(s.content ?? ''));
  }
  return parts.join(' ');
}

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id,slug,status,template,title,meta_description,intro,body_json,schema_org,internal_links,primary_keyword')
    .in('status', ['published', 'approved']);

  if (error) {
    throw new Error(`Unable to load pages for quality gate: ${error.message}`);
  }

  const failures: Array<{ id: string; slug: string; template: string | null; errors: string[] }> = [];
  let passed = 0;

  for (const page of pages ?? []) {
    const errors = runPublishGuards(page);

    // Content uniqueness check
    const allText = collectAllText(page);
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
