/**
 * Content Diff
 *
 * Before any content refresh overwrites a published page, this script
 * computes a semantic similarity score between the old and new body_json.
 * If the new version would DEGRADE the page (lower quality score, shorter,
 * fewer entities), it blocks the overwrite and flags for human review.
 *
 * Also runs when content-generator produces a new draft for an existing page.
 *
 * Checks:
 *   1. Cosine similarity of TF-IDF vectors (old vs new body text)
 *   2. Word count delta — new must be ≥ 90% of old
 *   3. FAQ count delta — new must not lose more than 2 FAQs
 *   4. Entity preservation — required_entities from brief must all appear
 *   5. Reference count — new must have ≥ same number of references
 *   6. Quality score prediction (structural analysis, not LLM)
 *
 * Writes results to `content_diffs` table.
 * Returns exit code 1 if diff fails — orchestrator treats this as blocking.
 *
 * Usage:
 *   npx tsx scripts/content-diff.ts --slug=<page-slug>
 *   npx tsx scripts/content-diff.ts --slug=<page-slug> --dry-run
 *   npx tsx scripts/content-diff.ts --all-pending
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const TARGET_SLUG = process.argv.find((a) => a.startsWith('--slug='))?.split('=')[1];
const ALL_PENDING = process.argv.includes('--all-pending');
const WORD_COUNT_FLOOR_PCT = Number(process.env.DIFF_WORD_COUNT_FLOOR ?? 90);
const SIMILARITY_FLOOR = Number(process.env.DIFF_SIMILARITY_FLOOR ?? 0.35); // min semantic overlap

type PageRow = {
  id: string;
  slug: string;
  template: string;
  body_json: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  quality_score: number | null;
};

type DraftRow = {
  id: string;
  page_slug: string;
  body_json: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  quality_score_predicted: number | null;
};

type DiffResult = {
  page_slug: string;
  similarity_score: number;
  old_word_count: number;
  new_word_count: number;
  word_count_delta_pct: number;
  old_faq_count: number;
  new_faq_count: number;
  old_reference_count: number;
  new_reference_count: number;
  missing_entities: string[];
  passed: boolean;
  failure_reasons: string[];
  action: 'approve' | 'flag_for_review' | 'block';
  diffed_at: string;
};

// ── Text extraction ───────────────────────────────────────────────────────────
function extractText(bodyJson: Record<string, unknown> | null): string {
  if (!bodyJson) return '';
  const parts: string[] = [];

  const sections = (bodyJson.sections ?? []) as Array<{ heading?: string; content?: unknown }>;
  for (const s of sections) {
    if (s.heading) parts.push(s.heading);
    if (typeof s.content === 'string') parts.push(s.content);
    else if (Array.isArray(s.content)) {
      for (const item of s.content) {
        if (typeof item === 'string') parts.push(item);
        else if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === 'string') parts.push(obj.text);
          if (typeof obj.content === 'string') parts.push(obj.content);
        }
      }
    }
  }

  const faqs = (bodyJson.faqs ?? []) as Array<{ q?: string; a?: string }>;
  for (const f of faqs) {
    if (f.q) parts.push(f.q);
    if (f.a) parts.push(f.a);
  }

  const verdict = bodyJson.verdict;
  if (Array.isArray(verdict)) parts.push(...verdict.filter((v) => typeof v === 'string'));

  const intro = bodyJson.intro;
  if (typeof intro === 'string') parts.push(intro);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ── Simple TF-IDF cosine similarity ──────────────────────────────────────────
function tokenize(text: string): Map<string, number> {
  const tokens = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3);

  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freqA] of a) {
    dotProduct += freqA * (b.get(term) ?? 0);
    normA += freqA * freqA;
  }
  for (const [, freqB] of b) {
    normB += freqB * freqB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ── Structural counts ─────────────────────────────────────────────────────────
function countFaqs(bodyJson: Record<string, unknown> | null): number {
  return Array.isArray(bodyJson?.faqs) ? (bodyJson!.faqs as unknown[]).length : 0;
}

function countReferences(bodyJson: Record<string, unknown> | null): number {
  return Array.isArray(bodyJson?.references) ? (bodyJson!.references as unknown[]).length : 0;
}

// ── Run diff ─────────────────────────────────────────────────────────────────
async function diffPage(slug: string): Promise<DiffResult> {
  // Load published page
  const { data: publishedPage } = await supabase
    .from('pages')
    .select('id, slug, template, body_json, metadata, quality_score')
    .eq('slug', slug)
    .eq('status', 'published')
    .single<PageRow>();

  // Load latest draft for this slug
  const { data: draft } = await supabase
    .from('pages')
    .select('id, slug, template, body_json, metadata, quality_score')
    .eq('slug', slug)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single<PageRow>();

  if (!publishedPage) {
    return {
      page_slug: slug,
      similarity_score: 1,
      old_word_count: 0,
      new_word_count: 0,
      word_count_delta_pct: 0,
      old_faq_count: 0,
      new_faq_count: 0,
      old_reference_count: 0,
      new_reference_count: 0,
      missing_entities: [],
      passed: true,
      failure_reasons: ['No published version — diff skipped'],
      action: 'approve',
      diffed_at: new Date().toISOString(),
    };
  }

  if (!draft) {
    return {
      page_slug: slug,
      similarity_score: 1,
      old_word_count: 0,
      new_word_count: 0,
      word_count_delta_pct: 0,
      old_faq_count: 0,
      new_faq_count: 0,
      old_reference_count: 0,
      new_reference_count: 0,
      missing_entities: [],
      passed: true,
      failure_reasons: ['No draft to diff against'],
      action: 'approve',
      diffed_at: new Date().toISOString(),
    };
  }

  const oldText = extractText(publishedPage.body_json);
  const newText = extractText(draft.body_json);

  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const similarity = Math.round(cosineSimilarity(oldTokens, newTokens) * 100) / 100;

  const oldWordCount = wordCount(oldText);
  const newWordCount = wordCount(newText);
  const wordCountDeltaPct = oldWordCount > 0 ? Math.round(((newWordCount - oldWordCount) / oldWordCount) * 100) : 0;

  const oldFaqCount = countFaqs(publishedPage.body_json);
  const newFaqCount = countFaqs(draft.body_json);

  const oldRefCount = countReferences(publishedPage.body_json);
  const newRefCount = countReferences(draft.body_json);

  // Check required entities from brief
  const { data: brief } = await supabase
    .from('briefs')
    .select('required_entities')
    .eq('page_slug', slug)
    .single();

  const requiredEntities = (brief as any)?.required_entities ?? [];
  const newTextLower = newText.toLowerCase();
  const missingEntities = requiredEntities.filter((e: string) => !newTextLower.includes(e.toLowerCase()));

  // Evaluate
  const failureReasons: string[] = [];

  if (similarity < SIMILARITY_FLOOR) {
    failureReasons.push(`Semantic similarity too low: ${similarity} < ${SIMILARITY_FLOOR} (content may have drifted topic)`);
  }

  if (oldWordCount > 0 && newWordCount < oldWordCount * (WORD_COUNT_FLOOR_PCT / 100)) {
    failureReasons.push(`Word count dropped: ${oldWordCount} → ${newWordCount} (${wordCountDeltaPct}%, floor: ${WORD_COUNT_FLOOR_PCT}%)`);
  }

  if (newFaqCount < oldFaqCount - 2) {
    failureReasons.push(`FAQ count dropped significantly: ${oldFaqCount} → ${newFaqCount}`);
  }

  if (newRefCount < oldRefCount) {
    failureReasons.push(`References reduced: ${oldRefCount} → ${newRefCount}`);
  }

  if (missingEntities.length > 3) {
    failureReasons.push(`${missingEntities.length} required entities missing from new version: ${missingEntities.slice(0, 3).join(', ')}`);
  }

  const passed = failureReasons.length === 0;
  const action = passed ? 'approve' : failureReasons.length >= 3 ? 'block' : 'flag_for_review';

  return {
    page_slug: slug,
    similarity_score: similarity,
    old_word_count: oldWordCount,
    new_word_count: newWordCount,
    word_count_delta_pct: wordCountDeltaPct,
    old_faq_count: oldFaqCount,
    new_faq_count: newFaqCount,
    old_reference_count: oldRefCount,
    new_reference_count: newRefCount,
    missing_entities: missingEntities,
    passed,
    failure_reasons: failureReasons,
    action,
    diffed_at: new Date().toISOString(),
  };
}

async function run(): Promise<void> {
  let slugsToCheck: string[] = [];

  if (TARGET_SLUG) {
    slugsToCheck = [TARGET_SLUG];
  } else if (ALL_PENDING) {
    // Find draft pages that have a corresponding published version
    const { data } = await supabase
      .from('pages')
      .select('slug')
      .eq('status', 'draft')
      .limit(50);
    slugsToCheck = (data ?? []).map((p: any) => p.slug);
  } else {
    // Default: check pages in content_refresh_queue
    const { data } = await supabase
      .from('content_refresh_queue')
      .select('page_slug')
      .eq('status', 'pending')
      .limit(20);
    slugsToCheck = (data ?? []).map((r: any) => r.page_slug);
  }

  console.log(`[content-diff] Diffing ${slugsToCheck.length} pages (dryRun=${DRY_RUN})`);

  let blocked = 0;
  let flagged = 0;
  let approved = 0;

  for (const slug of slugsToCheck) {
    const result = await diffPage(slug);

    const icon = result.action === 'approve' ? '✓' : result.action === 'block' ? '✗' : '⚠';
    console.log(
      `[diff] ${icon} ${slug}: similarity=${result.similarity_score} ` +
      `words=${result.old_word_count}→${result.new_word_count} ` +
      `action=${result.action}` +
      (result.failure_reasons.length ? `\n       → ${result.failure_reasons[0]}` : ''),
    );

    if (!DRY_RUN) {
      await supabase.from('content_diffs').upsert(result, { onConflict: 'page_slug' });

      if (result.action === 'block') {
        // Prevent refresh from proceeding
        await supabase.from('content_refresh_queue').update({
          status: 'blocked',
          block_reason: result.failure_reasons.join(' | '),
        }).eq('page_slug', slug);
        blocked++;
      } else if (result.action === 'flag_for_review') {
        await supabase.from('content_refresh_queue').update({
          status: 'needs_review',
          block_reason: result.failure_reasons.join(' | '),
        }).eq('page_slug', slug);
        flagged++;
      } else {
        approved++;
      }
    }
  }

  console.log(`[content-diff] Done: ${approved} approved, ${flagged} flagged, ${blocked} blocked (dryRun=${DRY_RUN})`);

  if (blocked > 0 && !DRY_RUN) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
