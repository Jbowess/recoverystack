import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { runPublishGuards } from '@/lib/publish-guards';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id,slug,status,template,title,intro,body_json,schema_org,internal_links')
    .in('status', ['published']);

  if (error) {
    throw new Error(`Unable to load pages for quality gate: ${error.message}`);
  }

  const failures: Array<{ slug: string; errors: string[] }> = [];

  for (const page of pages ?? []) {
    const errors = runPublishGuards(page);
    if (errors.length) {
      failures.push({ slug: page.slug, errors });
    }
  }

  if (failures.length) {
    console.error(`Quality gate failed for ${failures.length} page(s):`);
    for (const failure of failures) {
      console.error(`\n- ${failure.slug}`);
      for (const err of failure.errors) {
        console.error(`  • ${err}`);
      }
    }
    process.exit(1);
  }

  console.log(`Quality gate passed for ${(pages ?? []).length} published page(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
