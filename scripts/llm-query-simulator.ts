import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { normalizeDiscoveryQuery } from '@/lib/llm-discovery';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const CHANNEL = process.env.LLM_SIM_CHANNEL ?? 'chatgpt';
const LIMIT = Number(process.env.LLM_SIM_LIMIT ?? 500);

type QueryTargetRow = {
  page_id: string | null;
  page_slug: string | null;
  query: string;
  normalized_query: string;
  priority: number | null;
  current_position: number | null;
};

type PageScoreRow = {
  id: string;
  slug: string;
  llm_readiness_score: number | null;
};

async function run() {
  const [queryTargetsResult, promptCorpusResult, pagesResult] = await Promise.all([
    supabase
      .from('page_query_targets')
      .select('page_id,page_slug,query,normalized_query,priority,current_position')
      .order('priority', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('llm_prompt_corpus')
      .select('page_id,page_slug,prompt_text,normalized_prompt,priority')
      .eq('channel', CHANNEL)
      .eq('status', 'active')
      .order('priority', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('pages')
      .select('id,slug,llm_readiness_score')
      .eq('status', 'published')
      .limit(LIMIT),
  ]);

  if (queryTargetsResult.error) throw queryTargetsResult.error;
  if (promptCorpusResult.error) throw promptCorpusResult.error;
  if (pagesResult.error) throw pagesResult.error;

  const pageScores = new Map(
    ((pagesResult.data ?? []) as PageScoreRow[]).map((row) => [row.id, row]),
  );

  const combinedTargets: QueryTargetRow[] = [
    ...((queryTargetsResult.data ?? []) as QueryTargetRow[]),
    ...((promptCorpusResult.data ?? []) as Array<{
      page_id: string | null;
      page_slug: string | null;
      prompt_text: string;
      normalized_prompt: string;
      priority: number | null;
    }>).map((row) => ({
      page_id: row.page_id,
      page_slug: row.page_slug,
      query: row.prompt_text,
      normalized_query: row.normalized_prompt,
      priority: row.priority,
      current_position: null,
    })),
  ];

  const grouped = new Map<string, QueryTargetRow[]>();
  for (const row of combinedTargets) {
    const key = row.normalized_query || normalizeDiscoveryQuery(row.query);
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  let simulated = 0;

  for (const [normalizedQuery, candidates] of grouped.entries()) {
    const ranked = candidates
      .map((candidate) => {
        const page = candidate.page_id ? pageScores.get(candidate.page_id) : null;
        const llmScore = page?.llm_readiness_score ?? 50;
        const priority = candidate.priority ?? 50;
        const positionBonus = candidate.current_position && candidate.current_position > 0
          ? Math.max(0, 100 - candidate.current_position * 6)
          : 45;
        const confidence = Math.round(priority * 0.5 + llmScore * 0.35 + positionBonus * 0.15);

        return {
          candidate,
          llmScore,
          priority,
          positionBonus,
          confidence,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];
    if (!best) continue;

    const payload = {
      query: best.candidate.query,
      normalized_query: normalizedQuery,
      channel: CHANNEL,
      simulated_date: new Date().toISOString().slice(0, 10),
      matched_page_id: best.candidate.page_id,
      matched_page_slug: best.candidate.page_slug,
      confidence_score: best.confidence,
      result_status: best.confidence >= 75 ? 'strong_candidate' : best.confidence >= 60 ? 'candidate' : 'weak_candidate',
      evidence: [
        { kind: 'query_priority', value: best.priority },
        { kind: 'llm_readiness_score', value: best.llmScore },
        { kind: 'position_bonus', value: best.positionBonus },
      ],
      metadata: {},
    };

    if (DRY_RUN) {
      console.log(`[llm-sim] ${best.candidate.query} -> ${best.candidate.page_slug} (${best.confidence})`);
      simulated += 1;
      continue;
    }

    const { error } = await supabase.from('llm_query_simulations').upsert(payload, {
      onConflict: 'normalized_query,channel,simulated_date',
    });

    if (error) throw error;
    simulated += 1;
  }

  console.log(`[llm-sim] simulated=${simulated} channel=${CHANNEL} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
