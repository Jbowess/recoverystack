/**
 * PAA (People Also Ask) Page Factory
 *
 * Reads content_gaps.serp_snapshot.people_also_ask from all gap rows
 * and creates dedicated keyword_queue entries for each unique PAA question
 * not already covered by an existing page or queue entry.
 *
 * PAA pages win featured snippets at extremely high rates because Google
 * is literally telling you what questions it considers authoritative.
 *
 * Run: npm run paa:factory
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildClusterName, normalizeKeyword, pageTemplateToQueueTemplateId } from '@/lib/seo-keywords';
import type { TemplateType } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TEMPLATE_RULES: Array<{ patterns: RegExp[]; template: TemplateType }> = [
  { patterns: [/\bvs\b/i, /\bbetter\b/i, /\bcompare\b/i, /\bdifference\b/i], template: 'alternatives' },
  { patterns: [/\bprotocol\b/i, /\bschedule\b/i, /\bstep[s]?\b/i, /\bhow (many|often|long)\b/i], template: 'protocols' },
  { patterns: [/\bhrv\b/i, /\bscore\b/i, /\bmeasure\b/i, /\btrack\b/i, /\baccurate\b/i], template: 'metrics' },
  { patterns: [/\bcost\b/i, /\bprice\b/i, /\bexpensive\b/i, /\bworth\b/i, /\bsubscription\b/i], template: 'costs' },
  { patterns: [/\bwork with\b/i, /\bcompatib\b/i, /\bintegrat\b/i, /\bpair\b/i, /\bsync\b/i], template: 'compatibility' },
];

function inferTemplate(question: string): TemplateType {
  for (const rule of TEMPLATE_RULES) {
    if (rule.patterns.some((p) => p.test(question))) return rule.template;
  }
  return 'guides';
}

function questionToSlug(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

interface PaaItem {
  question: string;
  snippet?: string;
}

interface SerpSnapshot {
  people_also_ask?: PaaItem[];
  keyword?: string;
}

interface GapRow {
  keyword: string;
  page_slug: string;
  serp_snapshot?: SerpSnapshot;
}

async function run() {
  // Load all existing pages + keyword_queue slugs/keywords to avoid duplication
  const [pagesResult, queueResult] = await Promise.all([
    supabase.from('pages').select('slug, primary_keyword').eq('status', 'published'),
    supabase.from('keyword_queue').select('normalized_keyword'),
  ]);

  const existingKeywords = new Set<string>([
    ...((pagesResult.data ?? []) as Array<{ primary_keyword: string | null }>)
      .map((p) => normalizeKeyword(p.primary_keyword ?? ''))
      .filter(Boolean),
    ...((queueResult.data ?? []) as Array<{ normalized_keyword: string | null }>)
      .map((k) => normalizeKeyword(k.normalized_keyword ?? ''))
      .filter(Boolean),
  ]);

  const existingSlugs = new Set(
    ((pagesResult.data ?? []) as Array<{ slug: string }>).map((p) => p.slug),
  );

  console.log(`[paa-factory] ${existingKeywords.size} existing keywords, ${existingSlugs.size} existing page slugs.`);

  // Load all content_gaps with PAA data
  const { data: gaps, error } = await supabase
    .from('content_gaps')
    .select('keyword, page_slug, serp_snapshot')
    .not('serp_snapshot', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  const toInsert: Array<{
    primary_keyword: string;
    normalized_keyword: string;
    template_id: string;
    source: string;
    priority: number;
    status: string;
    score: number;
    cluster_name: string;
    metadata: Record<string, unknown>;
  }> = [];

  const seen = new Set<string>(existingKeywords);
  let totalPaa = 0;

  for (const gap of (gaps ?? []) as GapRow[]) {
    const snapshot: SerpSnapshot = gap.serp_snapshot ?? {};
    const paaItems = snapshot.people_also_ask ?? [];
    totalPaa += paaItems.length;

    for (const item of paaItems) {
      const question = item.question?.trim();
      if (!question || question.length < 15) continue;

      const normalized = normalizeKeyword(question);
      if (seen.has(normalized)) continue;

      const slug = questionToSlug(question);
      if (existingSlugs.has(slug)) continue;

      seen.add(normalized);

      const template = inferTemplate(question);

      toInsert.push({
        primary_keyword: question,
        normalized_keyword: normalized,
        template_id: pageTemplateToQueueTemplateId(template),
        source: 'paa',
        priority: 75, // PAA questions get elevated priority
        status: 'new',
        score: 0.75,
        cluster_name: buildClusterName(gap.page_slug.replace(/^trend:/, '').replace(/-/g, ' ')),
        metadata: {
          parent_keyword: gap.keyword,
          parent_slug: gap.page_slug,
          paa_snippet: item.snippet?.slice(0, 200) ?? null,
          source_type: 'paa_question',
        },
      });
    }
  }

  console.log(`[paa-factory] Scanned ${(gaps ?? []).length} gap rows, found ${totalPaa} PAA questions, ${toInsert.length} new unique ones.`);

  if (toInsert.length === 0) {
    console.log('[paa-factory] No new PAA pages to enqueue.');
    return;
  }

  // Batch upsert in chunks of 100
  let inserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error: upsertErr } = await supabase
      .from('keyword_queue')
      .upsert(chunk, { onConflict: 'cluster_name,primary_keyword' });

    if (upsertErr) {
      console.warn(`[paa-factory] Chunk upsert error: ${upsertErr.message}`);
    } else {
      inserted += chunk.length;
    }
  }

  console.log(`[paa-factory] Enqueued ${inserted} PAA-derived page keywords.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
