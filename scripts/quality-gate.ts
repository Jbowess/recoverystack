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

  const failures: Array<{ id: string; slug: string; template: string | null; errors: string[] }> = [];

  for (const page of pages ?? []) {
    const errors = runPublishGuards(page);
    if (errors.length) {
      failures.push({ id: page.id, slug: page.slug, template: page.template ?? null, errors });
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

  console.log(`Quality gate passed for ${(pages ?? []).length} published page(s).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
