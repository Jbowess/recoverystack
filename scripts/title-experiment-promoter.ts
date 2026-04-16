/**
 * Title Experiment Promoter
 *
 * Looks for pages that have:
 *   1. Suggested title experiments (from ctr-optimizer) older than MIN_DAYS_OLD days
 *   2. Current CTR still below CTR_PROMOTE_THRESHOLD over the last 28 days
 *
 * For each qualifying page, picks the best-scoring variant using Discover heuristics
 * (title length, number presence, power word) and applies it to pages.title.
 * Marks promoted experiments as 'applied' and the rest as 'superseded'.
 *
 * Run: npm run title:promote
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MIN_DAYS_OLD = Number(process.env.TITLE_EXPERIMENT_MIN_DAYS ?? 14);
const CTR_PROMOTE_THRESHOLD = Number(process.env.TITLE_PROMOTE_CTR_THRESHOLD ?? 0.03); // 3%
const MIN_IMPRESSIONS = Number(process.env.TITLE_PROMOTE_MIN_IMPRESSIONS ?? 50);

// Power words that correlate with higher organic CTR
const POWER_WORDS = [
  'best', 'worst', 'tested', 'proven', 'actually', 'never', 'always',
  'exact', 'real', 'hidden', 'why', 'how', 'what', 'new', 'critical',
  'essential', 'truth', 'mistake', 'warning', 'surprising',
];

interface ExperimentRow {
  id: string;
  page_id: string;
  page_slug: string;
  channel: string;
  variant: string;
  title: string;
  score: number | null;
  status: string;
  reason: string | null;
  metrics: Record<string, unknown> | null;
  generated_at: string;
}

interface PageRow {
  id: string;
  slug: string;
  title: string;
  template: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Score a title for CTR-friendliness using heuristics from discover-optimizer.
 * Higher is better (max ~100).
 */
function scoreTitleForCtr(title: string): number {
  let score = 0;

  // Length: 40–65 chars is optimal for search snippets
  const len = title.length;
  if (len >= 40 && len <= 65) score += 30;
  else if (len >= 30 && len < 40) score += 20;
  else if (len > 65 && len <= 75) score += 15;

  // Contains a number (specificity signal)
  if (/\d/.test(title)) score += 20;

  // Contains a power word
  const lower = title.toLowerCase();
  if (POWER_WORDS.some((word) => lower.includes(word))) score += 20;

  // Question format (high CTR for informational queries)
  if (title.trim().endsWith('?')) score += 10;

  // Negative patterns (penalise)
  if (/[A-Z]{4,}/.test(title)) score -= 15; // Excessive caps
  if (/[!]{2,}/.test(title)) score -= 10;
  if (title.length > 80) score -= 10; // Too long — truncated in SERP

  return Math.max(0, score);
}

async function getAverageCtr(slug: string, since: string): Promise<{ ctr: number; impressions: number }> {
  const { data } = await supabase
    .from('page_metrics_daily')
    .select('clicks, impressions')
    .eq('page_slug', slug)
    .gte('date', since);

  if (!data || data.length === 0) return { ctr: 0, impressions: 0 };

  const totalClicks = data.reduce((sum, r) => sum + (r.clicks ?? 0), 0);
  const totalImpressions = data.reduce((sum, r) => sum + (r.impressions ?? 0), 0);
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  return { ctr, impressions: totalImpressions };
}

async function run() {
  const cutoffDate = new Date(Date.now() - MIN_DAYS_OLD * 24 * 60 * 60 * 1000).toISOString();
  const since28 = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Fetch suggested experiments that are old enough to evaluate
  const { data: experiments, error } = await supabase
    .from('page_title_experiments')
    .select('id,page_id,page_slug,channel,variant,title,score,status,reason,metrics,generated_at')
    .eq('status', 'suggested')
    .lt('generated_at', cutoffDate)
    .order('generated_at', { ascending: true });

  if (error) throw error;
  if (!experiments || experiments.length === 0) {
    console.log('[title-experiment-promoter] No eligible experiments found.');
    return;
  }

  // Group experiments by page
  const byPage = new Map<string, ExperimentRow[]>();
  for (const exp of experiments as ExperimentRow[]) {
    const existing = byPage.get(exp.page_id) ?? [];
    existing.push(exp);
    byPage.set(exp.page_id, existing);
  }

  console.log(`[title-experiment-promoter] Found ${byPage.size} page(s) with eligible experiments`);

  // Fetch pages
  const pageIds = Array.from(byPage.keys());
  const { data: pages, error: pageErr } = await supabase
    .from('pages')
    .select('id,slug,title,template,metadata')
    .in('id', pageIds);

  if (pageErr) throw pageErr;
  if (!pages) return;

  let promoted = 0;
  let skipped = 0;

  for (const page of pages as PageRow[]) {
    const pageExperiments = byPage.get(page.id) ?? [];
    if (pageExperiments.length === 0) continue;

    // Check if current CTR is still below threshold
    const { ctr, impressions } = await getAverageCtr(page.slug, since28);

    if (impressions < MIN_IMPRESSIONS) {
      // Not enough data to make a decision
      skipped++;
      console.log(
        `[title-experiment-promoter] Skipping "${page.slug}" — only ${impressions} impressions (min ${MIN_IMPRESSIONS})`,
      );
      continue;
    }

    if (ctr >= CTR_PROMOTE_THRESHOLD) {
      // CTR already good enough — no need to swap title
      skipped++;
      console.log(
        `[title-experiment-promoter] Skipping "${page.slug}" — CTR ${(ctr * 100).toFixed(2)}% already above threshold`,
      );
      continue;
    }

    // Score each variant and pick the best
    const scored = pageExperiments.map((exp) => ({
      ...exp,
      heuristicScore: scoreTitleForCtr(exp.title),
    }));

    scored.sort((a, b) => b.heuristicScore - a.heuristicScore);
    const winner = scored[0];

    // Only promote if the variant is meaningfully better than the current title
    const currentScore = scoreTitleForCtr(page.title);
    if (winner.heuristicScore <= currentScore) {
      skipped++;
      console.log(
        `[title-experiment-promoter] Skipping "${page.slug}" — best variant score ${winner.heuristicScore} not better than current ${currentScore}`,
      );
      continue;
    }

    // Apply the winning title
    const newMetadata = {
      ...(page.metadata ?? {}),
      title_promoted_from: page.title,
      title_promoted_at: new Date().toISOString(),
      title_promoted_variant: winner.variant,
      title_promoted_ctr_at_switch: ctr,
    };

    const [{ error: updateErr }, { error: winnerErr }] = await Promise.all([
      supabase
        .from('pages')
        .update({ title: winner.title, metadata: newMetadata })
        .eq('id', page.id),
      supabase
        .from('page_title_experiments')
        .update({ status: 'applied', selected_at: new Date().toISOString() })
        .eq('id', winner.id),
    ]);

    if (updateErr || winnerErr) {
      console.warn(
        `[title-experiment-promoter] Failed to update "${page.slug}": ${updateErr?.message ?? winnerErr?.message}`,
      );
      continue;
    }

    // Mark the rest as superseded
    const losers = scored.slice(1).map((exp) => exp.id);
    if (losers.length > 0) {
      await supabase
        .from('page_title_experiments')
        .update({ status: 'superseded' })
        .in('id', losers);
    }

    promoted++;
    console.log(
      `[title-experiment-promoter] Promoted title for "${page.slug}"\n  Old: "${page.title}" (score ${currentScore})\n  New: "${winner.title}" (score ${winner.heuristicScore}, CTR was ${(ctr * 100).toFixed(2)}%)`,
    );
  }

  console.log(
    `\n[title-experiment-promoter] Done. Promoted: ${promoted} | Skipped: ${skipped}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
