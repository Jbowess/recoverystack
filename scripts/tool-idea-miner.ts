import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function inferIdea(page: any) {
  const text = `${page.title} ${page.primary_keyword ?? ''} ${page.meta_description ?? ''}`.toLowerCase();
  if (text.includes('cost') || text.includes('subscription')) return { ideaType: 'calculator', title: `${page.title} calculator`, rationale: 'Page has pricing/comparison intent that maps to a TCO calculator.' };
  if (text.includes('compatibility') || text.includes('iphone') || text.includes('android')) return { ideaType: 'checker', title: `${page.title} checker`, rationale: 'Compatibility intent maps to a checker tool.' };
  if (text.includes('best') || text.includes('vs') || text.includes('alternative')) return { ideaType: 'selector', title: `${page.title} selector`, rationale: 'Decision-intent page can become a recommendation selector.' };
  if (text.includes('size') || text.includes('sizing') || text.includes('fit')) return { ideaType: 'worksheet', title: `${page.title} worksheet`, rationale: 'Sizing/fit pages can convert via an interactive worksheet.' };
  return { ideaType: 'quiz', title: `${page.title} quiz`, rationale: 'Buyer-intent page can become a short qualification quiz.' };
}

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('slug,title,primary_keyword,meta_description')
    .eq('status', 'published')
    .limit(200);

  if (error) throw error;

  let written = 0;
  for (const page of (data ?? []) as any[]) {
    const idea = inferIdea(page);
    written += 1;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('tool_idea_queue').upsert({
      page_slug: page.slug,
      idea_type: idea.ideaType,
      title: idea.title,
      rationale: idea.rationale,
      priority: 70,
      status: 'draft',
      metadata: { source_page_title: page.title },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'page_slug,idea_type' });

    if (upsertError?.message?.includes('tool_idea_queue')) {
      console.log('[tool-idea-miner] tool_idea_queue missing - skipping persistence.');
      break;
    }
    if (upsertError) throw upsertError;
  }

  console.log(`[tool-idea-miner] pages=${data?.length ?? 0} written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
