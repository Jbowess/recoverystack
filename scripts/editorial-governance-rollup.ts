import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function run() {
  const modern = await supabase
    .from('pages')
    .select('slug,template,body_json,metadata')
    .in('status', ['draft', 'approved', 'published'])
    .limit(200);

  const result = modern.error?.message?.includes('metadata')
    ? await supabase
        .from('pages')
        .select('slug,template,body_json')
        .in('status', ['draft', 'approved', 'published'])
        .limit(200)
    : modern;

  if (result.error) throw result.error;

  const flagged = (result.data ?? []).filter((page: any) => {
    const body = page.body_json ?? {};
    const needsMethod = ['reviews', 'alternatives', 'costs', 'metrics'].includes(page.template);
    if (needsMethod && !body.review_methodology) return true;
    const refs = Array.isArray(body.references) ? body.references.length : 0;
    return refs < 2;
  });

  console.log(`[editorial-governance-rollup] flagged_pages=${flagged.length}`);
  for (const page of flagged.slice(0, 25) as Array<any>) {
    const hasMethod = Boolean(page.body_json?.review_methodology);
    const refs = Array.isArray(page.body_json?.references) ? page.body_json.references.length : 0;
    console.log(`- ${page.slug} | template=${page.template} | methodology=${hasMethod} | refs=${refs}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
