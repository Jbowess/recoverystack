/**
 * Keyword Expander
 *
 * Fans out the keyword_queue from seed keywords to 500+ entries by:
 *   1. Reading all content_gaps rows for their PAA + related_searches data
 *   2. Deduplicating against existing keyword_queue entries
 *   3. Inserting new keyword rows with inferred template and priority score
 *
 * Also generates long-tail variations for each seed keyword using
 * modifier patterns (best, vs, how to, for athletes, review, etc.)
 *
 * Run: npm run keyword:expand
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildClusterName, normalizeKeyword, pageTemplateToQueueTemplateId, type QueueSource } from '@/lib/seo-keywords';
import type { TemplateType } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Template inference rules — keyword patterns → template
const TEMPLATE_RULES: Array<{ patterns: RegExp[]; template: TemplateType }> = [
  {
    patterns: [/\bvs\b/i, /\bcompare\b/i, /\bbest .+ for\b/i, /\balternative/i, /\bvs\./i],
    template: 'alternatives',
  },
  {
    patterns: [/\bprotocol\b/i, /\bschedule\b/i, /\bplan\b/i, /\broutine\b/i, /\bprogram\b/i],
    template: 'protocols',
  },
  {
    patterns: [/\bhrv\b/i, /\bmetric\b/i, /\bdata\b/i, /\bscore\b/i, /\btrack\b/i, /\bmeasure\b/i],
    template: 'metrics',
  },
  {
    patterns: [/\bcost\b/i, /\bprice\b/i, /\bworth\b/i, /\bexpensive\b/i, /\baffordable\b/i, /\bcheap\b/i],
    template: 'costs',
  },
  {
    patterns: [/\bcompatib\b/i, /\bworks with\b/i, /\bintegrat\b/i, /\bsync\b/i, /\bconnect\b/i],
    template: 'compatibility',
  },
  {
    patterns: [/\btrend\b/i, /\b2025\b/i, /\b2026\b/i, /\bnew\b/i, /\blatest\b/i, /\bupcoming\b/i],
    template: 'trends',
  },
  {
    patterns: [/\bcomplete guide\b/i, /\beverything.+need\b/i, /\bultimate\b/i, /\bhub\b/i],
    template: 'pillars',
  },
  {
    patterns: [/\breview\b/i, /\bworth it\b/i, /\bhonest.+test\b/i, /\brating\b/i, /\bshould i buy\b/i],
    template: 'reviews',
  },
  {
    patterns: [/\bchecklist\b/i, /\bcheat sheet\b/i, /\bpre.+checklist\b/i, /\bstep.+guide\b/i],
    template: 'checklists',
  },
];

function inferTemplate(keyword: string): TemplateType {
  for (const rule of TEMPLATE_RULES) {
    if (rule.patterns.some((p) => p.test(keyword))) return rule.template;
  }
  return 'guides';
}

function inferPriority(keyword: string, source: string): number {
  let score = 50;
  if (source === 'paa') score += 20; // PAA questions rank well
  if (/\bvs\b/i.test(keyword)) score += 15; // Commercial intent
  if (/\bbest\b/i.test(keyword)) score += 10;
  if (/\bhow to\b/i.test(keyword)) score += 8;
  if (/\breview\b/i.test(keyword)) score += 12;
  if (keyword.split(' ').length >= 4) score += 5; // Long-tail bonus
  if (keyword.split(' ').length >= 6) score += 5;
  return Math.min(score, 99);
}

// Long-tail modifier patterns applied to each seed keyword
const MODIFIERS = [
  'best {kw} for athletes',
  '{kw} vs alternatives',
  '{kw} review 2026',
  '{kw} for beginners',
  'how to use {kw}',
  '{kw} cost comparison',
  'is {kw} worth it',
  '{kw} accuracy test',
  '{kw} for sleep tracking',
  '{kw} for recovery',
  '{kw} vs whoop',
  '{kw} for marathon training',
  'does {kw} work',
  '{kw} battery life',
  '{kw} compatibility guide',
];

function generateModifierVariants(keyword: string): string[] {
  // Only expand short keywords (1-3 words) that aren't already long-tail
  if (keyword.split(' ').length > 3) return [];
  return MODIFIERS.map((m) => m.replace('{kw}', keyword)).filter((v) => v !== keyword);
}

interface SerpSnapshot {
  people_also_ask?: Array<{ question: string }>;
  related_searches?: Array<{ query: string }>;
}

interface GapRow {
  keyword: string;
  page_slug: string;
  serp_snapshot?: SerpSnapshot;
}

async function run() {
  // Load all existing keywords to deduplicate against
  const { data: existing } = await supabase
      .from('keyword_queue')
      .select('normalized_keyword');

  const existingSet = new Set(
    (existing ?? []).map((r: { normalized_keyword: string | null }) => normalizeKeyword(r.normalized_keyword ?? '')),
  );
  console.log(`[keyword-expander] ${existingSet.size} existing keywords in queue.`);

  // Load all content_gaps with SERP snapshot data
  const { data: gaps, error } = await supabase
    .from('content_gaps')
    .select('keyword, page_slug, serp_snapshot')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const toInsert: Array<{
    primary_keyword: string;
    normalized_keyword: string;
    template_id: string;
    source: QueueSource;
    priority: number;
    status: string;
    score: number;
    metadata: Record<string, unknown>;
    cluster_name: string;
  }> = [];

  const seen = new Set<string>(existingSet);

  for (const gap of (gaps ?? []) as GapRow[]) {
    const snapshot: SerpSnapshot = gap.serp_snapshot ?? {};

    // Extract PAA questions
    const paaQuestions = (snapshot.people_also_ask ?? []).map((p) => p.question).filter(Boolean);

    // Extract related searches
    const relatedSearches = (snapshot.related_searches ?? []).map((r) => r.query).filter(Boolean);

    // Generate modifier variants from the seed keyword
    const modifierVariants = generateModifierVariants(gap.keyword);

    const allCandidates = [
      ...paaQuestions.map((q) => ({ kw: q, source: 'paa' })),
      ...relatedSearches.map((q) => ({ kw: q, source: 'related_search' })),
      ...modifierVariants.map((q) => ({ kw: q, source: 'modifier_expansion' })),
    ];

    for (const { kw, source } of allCandidates) {
      const normalized = normalizeKeyword(kw);
      if (normalized.length < 10 || normalized.length > 120) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const template = inferTemplate(kw);
      const priority = inferPriority(kw, source);

      toInsert.push({
        primary_keyword: kw.trim(),
        normalized_keyword: normalized,
        template_id: pageTemplateToQueueTemplateId(template),
        source: source as QueueSource,
        priority,
        status: 'new',
        score: priority / 100,
        metadata: { expanded_from: gap.keyword, expansion_source: source },
        cluster_name: buildClusterName(gap.page_slug.replace(/^trend:/, '').replace(/-/g, ' ')),
      });
    }
  }

  if (toInsert.length === 0) {
    console.log('[keyword-expander] No new keywords to add.');
    return;
  }

  // Batch insert in chunks of 100
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error: insertErr } = await supabase
      .from('keyword_queue')
      .upsert(chunk, { onConflict: 'cluster_name,primary_keyword' });

    if (insertErr) {
      console.warn(`[keyword-expander] Chunk insert error: ${insertErr.message}`);
    } else {
      inserted += chunk.length;
    }
  }

  console.log(
    `[keyword-expander] Expanded keyword queue: +${inserted} new keywords (paa + related searches + modifier variants). Total queue size: ~${existingSet.size + inserted}.`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
