import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildPromptKey } from '@/lib/ai-reach';
import { normalizeDiscoveryQuery } from '@/lib/llm-discovery';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.LLM_PROMPT_LIMIT ?? 250);
const CHANNELS = ['chatgpt', 'perplexity', 'copilot'] as const;

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  primary_keyword: string | null;
  meta_description: string | null;
};

type QueryTargetRow = {
  page_id: string;
  page_slug: string;
  query: string;
  normalized_query: string;
  intent: string | null;
  priority: number | null;
};

function inferIntent(template: string, text: string) {
  if (['reviews', 'alternatives', 'costs', 'compatibility'].includes(template)) return 'commercial';
  if (/\b(price|cost|subscription|best|vs|alternative|compare)\b/i.test(text)) return 'commercial';
  if (template === 'news') return 'freshness';
  return 'informational';
}

function buildFallbackPrompts(page: PageRow) {
  const base = page.primary_keyword ?? page.title;
  const prompts = [
    base,
    `best ${base}`,
    `${base} comparison`,
    `${base} for recovery`,
  ];

  if (page.template === 'compatibility') prompts.push(`${base} iphone compatibility`);
  if (page.template === 'costs') prompts.push(`${base} subscription cost`);
  if (page.template === 'reviews') prompts.push(`${base} review tradeoffs`);

  return prompts
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .filter((prompt, index, list) => list.indexOf(prompt) === index)
    .slice(0, 4);
}

async function run() {
  const [pagesResult, queryTargetsResult] = await Promise.all([
    supabase
      .from('pages')
      .select('id,slug,template,title,primary_keyword,meta_description')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('page_query_targets')
      .select('page_id,page_slug,query,normalized_query,intent,priority')
      .order('priority', { ascending: false })
      .limit(LIMIT * 8),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  if (queryTargetsResult.error) throw queryTargetsResult.error;

  const queryTargetsByPage = new Map<string, QueryTargetRow[]>();
  for (const row of (queryTargetsResult.data ?? []) as QueryTargetRow[]) {
    const current = queryTargetsByPage.get(row.page_id) ?? [];
    current.push(row);
    queryTargetsByPage.set(row.page_id, current);
  }

  const rows: Array<Record<string, unknown>> = [];

  for (const page of (pagesResult.data ?? []) as PageRow[]) {
    const targetRows = (queryTargetsByPage.get(page.id) ?? []).slice(0, 4);
    const promptInputs = targetRows.length
      ? targetRows.map((row) => ({
          text: row.query,
          normalized: row.normalized_query || normalizeDiscoveryQuery(row.query),
          intent: row.intent ?? inferIntent(page.template, row.query),
          priority: row.priority ?? 70,
          source: 'page_query_targets',
        }))
      : buildFallbackPrompts(page).map((prompt, index) => ({
          text: prompt,
          normalized: normalizeDiscoveryQuery(prompt),
          intent: inferIntent(page.template, prompt),
          priority: Math.max(45, 80 - index * 6),
          source: 'fallback',
        }));

    for (const input of promptInputs) {
      for (const channel of CHANNELS) {
        rows.push({
          prompt_key: buildPromptKey(channel, input.text, page.slug),
          prompt_text: input.text,
          normalized_prompt: input.normalized,
          channel,
          intent: input.intent,
          page_id: page.id,
          page_slug: page.slug,
          priority: input.priority,
          status: 'active',
          metadata: {
            source: input.source,
            template: page.template,
            title: page.title,
            primary_keyword: page.primary_keyword,
            meta_description: page.meta_description,
          },
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  if (DRY_RUN) {
    console.log(`[llm-prompt-corpus] prompts=${rows.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('llm_prompt_corpus').upsert(rows, {
    onConflict: 'prompt_key',
  });

  if (error) throw error;
  console.log(`[llm-prompt-corpus] prompts=${rows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
