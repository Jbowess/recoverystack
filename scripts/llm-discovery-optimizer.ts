import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getLlmAnswerSection, parseLlmAnswerContent } from '@/lib/llm-discovery';
import type { PageRecord } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.LLM_DISCOVERY_LIMIT ?? 25);
const FORCE = process.argv.includes('--force') || process.env.LLM_DISCOVERY_FORCE === '1';

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  meta_description: string;
  primary_keyword: string | null;
  body_json: PageRecord['body_json'];
  metadata?: Record<string, unknown> | null;
  updated_at: string;
  llm_last_optimized_at?: string | null;
};

function fallbackAnswer(page: PageRow, questions: string[], references: Array<{ title: string; url: string; source?: string | null }>) {
  const keyword = page.primary_keyword ?? page.title;
  const directAnswer = `${keyword}: ${page.meta_description}`.split(/\s+/).slice(0, 55).join(' ');
  const bestFor = questions[0]
    ? `Best for: readers asking "${questions[0]}".`
    : `Best for: buyers and researchers evaluating ${keyword}.`;
  const keyFacts = [
    page.meta_description,
    ...references.slice(0, 3).map((item) => `${item.title}${item.source ? ` (${item.source})` : ''}`),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    direct_answer: directAnswer,
    best_for: bestFor,
    key_facts: keyFacts,
    evidence: references.slice(0, 3).map((item) => ({
      label: item.title,
      url: item.url,
      source: item.source ?? null,
    })),
    last_verified_at: new Date().toISOString(),
  };
}

async function generateAnswer(
  page: PageRow,
  questions: string[],
  references: Array<{ title: string; url: string; source?: string | null }>,
) {
  const prompt = `You are preparing a machine-readable answer block for an ecommerce SEO page that should be easy for AI systems to cite.

Page title: ${page.title}
Template: ${page.template}
Primary keyword: ${page.primary_keyword ?? page.title}
Meta description: ${page.meta_description}

Related user questions:
${questions.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join('\n')}

Available references:
${references.slice(0, 5).map((item, index) => `${index + 1}. ${item.title} | ${item.url}${item.source ? ` | ${item.source}` : ''}`).join('\n')}

Return JSON only with this shape:
{
  "direct_answer": "20-90 word direct answer",
  "best_for": "Best for: ...",
  "key_facts": ["2-5 short fact bullets"],
  "evidence": [{"label":"...", "url":"https://...", "source":"..."}],
  "last_verified_at": "ISO-8601 timestamp"
}`;

  try {
    if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim()) {
          return JSON.parse(text) as ReturnType<typeof fallbackAnswer>;
        }
      }
    }

    const ollama = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.2, num_predict: 500 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (ollama.ok) {
      const json = await ollama.json();
      if (typeof json.response === 'string' && json.response.trim()) {
        return JSON.parse(json.response) as ReturnType<typeof fallbackAnswer>;
      }
    }
  } catch {
    // Fall back to deterministic answer generation below.
  }

  return fallbackAnswer(page, questions, references);
}

async function run() {
  const pagesResult = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,primary_keyword,body_json,metadata,updated_at,llm_last_optimized_at')
    .eq('status', 'published')
    .order('llm_readiness_score', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(LIMIT);

  if (pagesResult.error) throw pagesResult.error;

  const pages = (pagesResult.data ?? []) as PageRow[];
  if (pages.length === 0) {
    console.log('[llm-discovery] No published pages found.');
    return;
  }

  const pageIds = pages.map((page) => page.id);

  const [queriesResult, refsResult] = await Promise.all([
    supabase
      .from('page_query_targets')
      .select('page_id,query,priority')
      .in('page_id', pageIds)
      .order('priority', { ascending: false }),
    supabase
      .from('page_source_references')
      .select('page_id,title,url,source_domain,authority_score')
      .in('page_id', pageIds)
      .order('authority_score', { ascending: false }),
  ]);

  const queriesByPage = new Map<string, string[]>();
  for (const row of (queriesResult.data ?? []) as Array<{ page_id: string; query: string }>) {
    const current = queriesByPage.get(row.page_id) ?? [];
    current.push(row.query);
    queriesByPage.set(row.page_id, current);
  }

  const refsByPage = new Map<string, Array<{ title: string; url: string; source?: string | null }>>();
  for (const row of (refsResult.data ?? []) as Array<{ page_id: string; title: string; url: string; source_domain: string | null }>) {
    const current = refsByPage.get(row.page_id) ?? [];
    current.push({
      title: row.title,
      url: row.url,
      source: row.source_domain ?? null,
    });
    refsByPage.set(row.page_id, current);
  }

  let updated = 0;

  for (const page of pages) {
    const currentAnswer = parseLlmAnswerContent(getLlmAnswerSection(page)?.content);
    if (currentAnswer && !FORCE) {
      console.log(`[llm-discovery] ${page.slug}: already has llm_answer`);
      continue;
    }

    const questions = queriesByPage.get(page.id) ?? [];
    const references = [
      ...(refsByPage.get(page.id) ?? []),
      ...((page.body_json?.references ?? []).map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source ?? null,
      }))),
    ].slice(0, 5);

    const answer = await generateAnswer(page, questions, references);
    const sections = page.body_json?.sections ?? [];
    const llmSection = {
      id: 'llm-answer',
      heading: 'Quick answer',
      kind: 'llm_answer',
      content: {
        ...answer,
        last_verified_at: answer.last_verified_at ?? new Date().toISOString(),
      },
    };

    const nextSections = [llmSection, ...sections.filter((section) => section.kind !== 'llm_answer')];
    const nextBody = {
      ...(page.body_json ?? {}),
      sections: nextSections,
    };

    console.log(`[llm-discovery] ${page.slug}: ${answer.direct_answer.slice(0, 72)}...`);

    if (DRY_RUN) {
      updated += 1;
      continue;
    }

    const { error } = await supabase.from('pages').update({
      body_json: nextBody,
      needs_revalidation: true,
      llm_last_optimized_at: new Date().toISOString(),
      metadata: {
        ...(page.metadata ?? {}),
        llm_discovery_updated_at: new Date().toISOString(),
      },
    }).eq('id', page.id);

    if (error) throw error;
    updated += 1;
  }

  console.log(`[llm-discovery] updated=${updated} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
