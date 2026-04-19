/**
 * Featured Snippet Optimizer
 *
 * Identifies keywords where we rank in positions 1–5 but don't own the
 * featured snippet, and queues format experiments to capture it.
 *
 * Strategy per snippet type (from serp_features):
 *   paragraph  → ensure a concise 40–60 word definition paragraph at the
 *                top of the page, starting with the keyword
 *   ordered_list → ensure numbered steps immediately after H1, no preamble
 *   unordered_list → ensure a tight bulleted list near page top
 *   table        → ensure comparison table in H2 position with matching headers
 *
 * Also detects "snippet displacement" — when we held a snippet before and
 * lost it — and flags for urgent re-optimisation.
 *
 * Writes experiments to `snippet_experiments` table.
 * Updates briefs.snippet_strategy for affected pages.
 *
 * Usage:
 *   npx tsx scripts/snippet-optimizer.ts
 *   npx tsx scripts/snippet-optimizer.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SNIPPET_POSITION_THRESHOLD = Number(process.env.SNIPPET_POSITION_THRESHOLD ?? 5);
const LIMIT = Number(process.env.SNIPPET_LIMIT ?? 100);
const SMART_RING_ONLY = process.argv.includes('--smart-ring-only');

type SnippetOpportunity = {
  keyword: string;
  page_slug: string;
  current_position: number;
  snippet_type: string;
  current_snippet_domain: string | null;
  current_snippet_text: string | null;
  strategy: string;
  instructions: string[];
  priority_score: number;
};

function isSmartRingKeyword(keyword: string, pageSlug: string): boolean {
  const haystack = `${keyword} ${pageSlug}`.toLowerCase();
  return ['smart ring', 'ringconn', 'oura', 'ultrahuman', 'galaxy ring', 'volo ring', 'wearable ring', 'sleep ring', 'recovery ring']
    .some((term) => haystack.includes(term));
}

// ── Strategy instructions per snippet type ────────────────────────────────────
function buildStrategy(snippetType: string, keyword: string, currentSnippetText: string | null): {
  strategy: string;
  instructions: string[];
} {
  switch (snippetType) {
    case 'paragraph':
      return {
        strategy: 'concise_definition_paragraph',
        instructions: [
          `Add a 40–60 word definition paragraph directly below the H1, starting with "${keyword} is..."`,
          'Avoid introductory preamble — lead immediately with the definition',
          `The paragraph must directly answer "what is ${keyword}" or "how does ${keyword} work"`,
          'Keep sentences under 20 words each',
          currentSnippetText ? `Current snippet to beat: "${currentSnippetText.slice(0, 150)}"` : '',
          'Place this paragraph before any table of contents or introductory content',
        ].filter(Boolean),
      };

    case 'ordered_list':
      return {
        strategy: 'numbered_steps_at_top',
        instructions: [
          'Immediately after H1, add a numbered list (ol) with 4–8 concise steps',
          'Each step should be 10–20 words — no long paragraphs',
          'Start each step with an action verb',
          `Steps should directly answer "how to ${keyword}"`,
          'Do NOT add preamble text between H1 and the list',
          'The list should be the first content element on the page',
        ],
      };

    case 'unordered_list':
      return {
        strategy: 'bulleted_list_at_top',
        instructions: [
          'Add a tight bulleted list (ul) within the first 150 words of content',
          'List 5–8 items, each under 15 words',
          `Items should directly answer "${keyword}" — key facts, features, or types`,
          'Format: lead with the most important/surprising item',
          'Avoid nested lists — keep flat structure',
        ],
      };

    case 'table':
      return {
        strategy: 'comparison_table_early',
        instructions: [
          'Move the primary comparison table to immediately follow the H1/intro (before first H2)',
          'Ensure table headers match the terms used in the featured snippet domain',
          'Table should have at least 3 columns and 4+ rows',
          'Include a "Winner" or "Best for" column if comparing products',
          'Keep table caption concise — it often becomes the snippet text',
        ],
      };

    default:
      return {
        strategy: 'general_snippet_optimization',
        instructions: [
          'Ensure the page directly answers the query in the first paragraph',
          'Use the exact keyword phrase in the first H2',
          'Keep intro under 100 words, answer-first format',
        ],
      };
  }
}

async function detectDisplacements(): Promise<string[]> {
  // Find keywords where we previously owned the snippet but no longer do
  const { data: history } = await supabase
    .from('rank_history')
    .select('keyword, featured_snippet_owned, checked_at')
    .eq('featured_snippet_owned', true)
    .order('checked_at', { ascending: false })
    .limit(500);

  if (!history) return [];

  const prevOwnedKeywords = new Set((history as Array<{ keyword: string }>).map((r) => r.keyword));

  const { data: current } = await supabase
    .from('serp_features')
    .select('keyword, has_featured_snippet, featured_snippet_domain')
    .in('keyword', [...prevOwnedKeywords]);

  const SITE_DOMAIN = (process.env.SITE_URL ?? 'https://recoverystack.io').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const displaced: string[] = [];

  for (const row of (current ?? []) as Array<{ keyword: string; has_featured_snippet: boolean; featured_snippet_domain: string | null }>) {
    if (row.has_featured_snippet && !row.featured_snippet_domain?.includes(SITE_DOMAIN)) {
      displaced.push(row.keyword);
    }
  }

  return displaced;
}

async function run(): Promise<void> {
  // Find pages in positions 1–5 without featured snippet ownership
  const { data: rankData } = await supabase
    .from('rank_history')
    .select('keyword, page_slug, position, featured_snippet_owned, checked_at')
    .eq('is_our_page', true)
    .lte('position', SNIPPET_POSITION_THRESHOLD)
    .eq('featured_snippet_owned', false)
    .order('checked_at', { ascending: false })
    .limit(LIMIT);

  // Cross-reference with serp_features for snippet type
  const opportunities: SnippetOpportunity[] = [];
  const displacedKeywords = await detectDisplacements();
  const displacedSet = new Set(displacedKeywords);

  for (const rank of (rankData ?? []) as Array<{
    keyword: string;
    page_slug: string | null;
    position: number;
    featured_snippet_owned: boolean;
  }>) {
    if (!rank.page_slug) continue;
    if (SMART_RING_ONLY && !isSmartRingKeyword(rank.keyword, rank.page_slug)) continue;

    const { data: serpFeature } = await supabase
      .from('serp_features')
      .select('has_featured_snippet, featured_snippet_type, featured_snippet_domain, featured_snippet_text')
      .eq('keyword', rank.keyword)
      .single();

    if (!serpFeature?.has_featured_snippet) continue;

    const snippetType = (serpFeature as any).featured_snippet_type ?? 'paragraph';
    const { strategy, instructions } = buildStrategy(
      snippetType,
      rank.keyword,
      (serpFeature as any).featured_snippet_text ?? null,
    );

    // Priority: displaced snippets get max priority, position 1 > position 5
    const baseScore = (SNIPPET_POSITION_THRESHOLD - rank.position + 1) * 15;
    const displacementBonus = displacedSet.has(rank.keyword) ? 30 : 0;
    const priorityScore = Math.min(100, baseScore + displacementBonus);

    opportunities.push({
      keyword: rank.keyword,
      page_slug: rank.page_slug,
      current_position: rank.position,
      snippet_type: snippetType,
      current_snippet_domain: (serpFeature as any).featured_snippet_domain ?? null,
      current_snippet_text: (serpFeature as any).featured_snippet_text?.slice(0, 200) ?? null,
      strategy,
      instructions,
      priority_score: priorityScore,
    });
  }

  opportunities.sort((a, b) => b.priority_score - a.priority_score);

  console.log(`[snippet-optimizer] Found ${opportunities.length} snippet opportunities, ${displacedKeywords.length} displacements (dryRun=${DRY_RUN}, smartRingOnly=${SMART_RING_ONLY})`);

  for (const opp of opportunities) {
    console.log(
      `[snippet] "${opp.keyword}": pos=${opp.current_position} type=${opp.snippet_type} ` +
      `vs ${opp.current_snippet_domain ?? 'unknown'} priority=${opp.priority_score}`,
    );

    if (DRY_RUN) continue;

    // Write experiment
    await supabase.from('snippet_experiments').upsert({
      keyword: opp.keyword,
      page_slug: opp.page_slug,
      current_position: opp.current_position,
      snippet_type: opp.snippet_type,
      current_snippet_domain: opp.current_snippet_domain,
      strategy: opp.strategy,
      instructions: opp.instructions,
      priority_score: opp.priority_score,
      status: 'pending',
      created_at: new Date().toISOString(),
    }, { onConflict: 'keyword' });

    // Update brief with snippet strategy
    await supabase.from('briefs').update({
      snippet_strategy: {
        snippet_type: opp.snippet_type,
        strategy: opp.strategy,
        instructions: opp.instructions,
        competing_domain: opp.current_snippet_domain,
        priority_score: opp.priority_score,
      },
    }).eq('page_slug', opp.page_slug);

    // Enqueue page for content refresh with snippet instructions
    if (opp.priority_score >= 50) {
      await supabase.from('content_refresh_queue').upsert({
        page_slug: opp.page_slug,
        reason: `snippet_opportunity:${opp.snippet_type}:pos${opp.current_position}`,
        priority: opp.priority_score >= 70 ? 'high' : 'medium',
        auto_approve: false,
        created_at: new Date().toISOString(),
      }, { onConflict: 'page_slug' });
    }
  }

  console.log('[snippet-optimizer] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
