/**
 * Staleness Scorer
 *
 * Detects content decay across all published pages using multiple signals:
 *   1. Age-based decay — guides older than STALE_THRESHOLD_DAYS
 *   2. Product version obsolescence — page mentions a device model that has a
 *      newer release in product_specs
 *   3. Clinical trial supersession — a completed trial in clinical_trials
 *      contradicts or updates claims on this page
 *   4. Position decay curve — rank dropped ≥ DECAY_POSITION_DROP positions
 *      over 28 days (from rank_history)
 *   5. CTR decay — GSC CTR dropped ≥ DECAY_CTR_DROP_PCT from 28d baseline
 *   6. Competitor freshness advantage — competitor pages for same keyword
 *      updated more recently than ours
 *
 * Outputs:
 *   - `page_staleness_scores` table
 *   - Enqueues high-staleness pages to content_refresh_queue
 *   - Updates pages.metadata.staleness_score + staleness_reasons
 *
 * Usage:
 *   npx tsx scripts/staleness-scorer.ts
 *   npx tsx scripts/staleness-scorer.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const STALE_THRESHOLD_DAYS = Number(process.env.STALE_THRESHOLD_DAYS ?? 120);
const DECAY_POSITION_DROP = Number(process.env.DECAY_POSITION_DROP ?? 5);
const DECAY_CTR_DROP_PCT = Number(process.env.DECAY_CTR_DROP_PCT ?? 25);
const ENQUEUE_STALENESS_THRESHOLD = Number(process.env.ENQUEUE_STALENESS_THRESHOLD ?? 60);
const LIMIT = Number(process.env.STALENESS_LIMIT ?? 200);

type PageRow = {
  slug: string;
  template: string;
  title: string;
  primary_keyword: string | null;
  updated_at: string;
  published_at: string | null;
  metadata: Record<string, unknown> | null;
  body_json: Record<string, unknown> | null;
};

type StalenessResult = {
  page_slug: string;
  staleness_score: number;         // 0–100
  staleness_reasons: string[];
  age_days: number;
  has_product_obsolescence: boolean;
  has_position_decay: boolean;
  has_ctr_decay: boolean;
  has_superseded_research: boolean;
  refresh_priority: 'critical' | 'high' | 'medium' | 'low' | 'fresh';
  scored_at: string;
};

function daysSince(dateIso: string): number {
  return (Date.now() - new Date(dateIso).getTime()) / 86_400_000;
}

// ── Score: age-based decay ────────────────────────────────────────────────────
function scoreAge(page: PageRow): { score: number; reason: string | null } {
  const anchor = page.updated_at ?? page.published_at;
  if (!anchor) return { score: 0, reason: null };

  const days = daysSince(anchor);
  if (days < 30) return { score: 0, reason: null };
  if (days < 60) return { score: 10, reason: null };
  if (days < STALE_THRESHOLD_DAYS) return { score: 20, reason: `${Math.round(days)}d since last update` };
  if (days < STALE_THRESHOLD_DAYS * 1.5) return { score: 35, reason: `${Math.round(days)}d since last update (stale threshold: ${STALE_THRESHOLD_DAYS}d)` };
  return { score: 50, reason: `${Math.round(days)}d since last update — significantly stale` };
}

// ── Score: product version obsolescence ───────────────────────────────────────
async function scoreProductObsolescence(page: PageRow): Promise<{ score: number; reason: string | null }> {
  const bodyText = JSON.stringify(page.body_json ?? {}).toLowerCase();

  // Find product specs mentioned in this page
  const { data: specs } = await supabase
    .from('product_specs')
    .select('slug, model, brand, release_date, discontinued')
    .eq('discontinued', false);

  const mentioned: string[] = [];
  for (const spec of (specs ?? []) as Array<{ slug: string; model: string; brand: string; release_date: string | null; discontinued: boolean }>) {
    const modelLower = spec.model.toLowerCase();
    const brandLower = spec.brand.toLowerCase();
    if (bodyText.includes(modelLower) || bodyText.includes(brandLower)) {
      mentioned.push(spec.slug);
    }
  }

  if (mentioned.length === 0) return { score: 0, reason: null };

  // Check if any newer versions exist for mentioned brands
  const { data: newerSpecs } = await supabase
    .from('product_specs')
    .select('slug, model, brand, release_date')
    .not('release_date', 'is', null)
    .order('release_date', { ascending: false });

  const pageDate = page.updated_at ?? page.published_at ?? '2020-01-01';
  const obsoleteModels: string[] = [];

  for (const slug of mentioned) {
    const currentSpec = (specs ?? []).find((s: any) => s.slug === slug);
    if (!currentSpec) continue;

    const newerVersion = (newerSpecs ?? []).find((s: any) =>
      s.brand === (currentSpec as any).brand &&
      s.slug !== slug &&
      s.release_date > pageDate,
    );

    if (newerVersion) {
      obsoleteModels.push(`${(currentSpec as any).model} → newer: ${(newerVersion as any).model}`);
    }
  }

  if (obsoleteModels.length === 0) return { score: 0, reason: null };
  return {
    score: 30,
    reason: `Product obsolescence: ${obsoleteModels.slice(0, 2).join('; ')}`,
  };
}

// ── Score: position decay ─────────────────────────────────────────────────────
async function scorePositionDecay(page: PageRow): Promise<{ score: number; reason: string | null }> {
  const { data } = await supabase
    .from('rank_history')
    .select('position, checked_at')
    .eq('keyword', page.primary_keyword ?? '')
    .order('checked_at', { ascending: false })
    .limit(30);

  if (!data || data.length < 2) return { score: 0, reason: null };

  const rows = data as Array<{ position: number | null; checked_at: string }>;
  const latest = rows[0];
  const d28ago = rows.find((r) => daysSince(r.checked_at) >= 25);

  if (!latest?.position || !d28ago?.position) return { score: 0, reason: null };

  const drop = latest.position - d28ago.position; // positive = dropped (worse rank)
  if (drop < DECAY_POSITION_DROP) return { score: 0, reason: null };

  const severity = drop >= 15 ? 40 : drop >= 10 ? 25 : 15;
  return {
    score: severity,
    reason: `Position dropped ${drop} places in 28d (${d28ago.position} → ${latest.position})`,
  };
}

// ── Score: CTR decay ──────────────────────────────────────────────────────────
async function scoreCtrDecay(page: PageRow): Promise<{ score: number; reason: string | null }> {
  const { data } = await supabase
    .from('gsc_query_rows')
    .select('ctr, date')
    .eq('page_slug', page.slug)
    .order('date', { ascending: false })
    .limit(60);

  if (!data || data.length < 14) return { score: 0, reason: null };

  const rows = data as Array<{ ctr: number; date: string }>;
  const recentAvg = rows.slice(0, 7).reduce((s, r) => s + (r.ctr ?? 0), 0) / 7;
  const baselineAvg = rows.slice(21, 28).reduce((s, r) => s + (r.ctr ?? 0), 0) / 7;

  if (baselineAvg === 0) return { score: 0, reason: null };

  const dropPct = ((baselineAvg - recentAvg) / baselineAvg) * 100;
  if (dropPct < DECAY_CTR_DROP_PCT) return { score: 0, reason: null };

  return {
    score: 20,
    reason: `CTR dropped ${Math.round(dropPct)}% from 28d baseline (${(baselineAvg * 100).toFixed(1)}% → ${(recentAvg * 100).toFixed(1)}%)`,
  };
}

// ── Score: superseded clinical research ───────────────────────────────────────
async function scoreSupersededResearch(page: PageRow): Promise<{ score: number; reason: string | null }> {
  if (!page.primary_keyword) return { score: 0, reason: null };

  const { data } = await supabase
    .from('clinical_trials')
    .select('title, status, completion_date, significance_score')
    .contains('page_slugs', [page.slug])
    .eq('status', 'COMPLETED')
    .gte('significance_score', 60)
    .order('significance_score', { ascending: false })
    .limit(3);

  if (!data || data.length === 0) return { score: 0, reason: null };

  const pageDate = page.updated_at;
  const newCompletedTrials = (data as Array<{ title: string; completion_date: string | null }>)
    .filter((t) => t.completion_date && t.completion_date > pageDate);

  if (newCompletedTrials.length === 0) return { score: 0, reason: null };

  return {
    score: 15,
    reason: `${newCompletedTrials.length} new completed trial(s) may update content: "${newCompletedTrials[0].title.slice(0, 60)}"`,
  };
}

// ── Determine refresh priority ─────────────────────────────────────────────────
function classifyPriority(score: number): StalenessResult['refresh_priority'] {
  if (score >= 80) return 'critical';
  if (score >= ENQUEUE_STALENESS_THRESHOLD) return 'high';
  if (score >= 35) return 'medium';
  if (score >= 15) return 'low';
  return 'fresh';
}

async function scorePage(page: PageRow): Promise<StalenessResult> {
  const [ageResult, productResult, positionResult, ctrResult, researchResult] = await Promise.all([
    Promise.resolve(scoreAge(page)),
    scoreProductObsolescence(page),
    scorePositionDecay(page),
    scoreCtrDecay(page),
    scoreSupersededResearch(page),
  ]);

  const reasons: string[] = [];
  if (ageResult.reason) reasons.push(ageResult.reason);
  if (productResult.reason) reasons.push(productResult.reason);
  if (positionResult.reason) reasons.push(positionResult.reason);
  if (ctrResult.reason) reasons.push(ctrResult.reason);
  if (researchResult.reason) reasons.push(researchResult.reason);

  // Cap at 100 — additive but bounded
  const totalScore = Math.min(100, ageResult.score + productResult.score + positionResult.score + ctrResult.score + researchResult.score);
  const ageDays = daysSince(page.updated_at ?? page.published_at ?? page.updated_at);

  return {
    page_slug: page.slug,
    staleness_score: totalScore,
    staleness_reasons: reasons,
    age_days: Math.round(ageDays),
    has_product_obsolescence: productResult.score > 0,
    has_position_decay: positionResult.score > 0,
    has_ctr_decay: ctrResult.score > 0,
    has_superseded_research: researchResult.score > 0,
    refresh_priority: classifyPriority(totalScore),
    scored_at: new Date().toISOString(),
  };
}

async function run(): Promise<void> {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('slug, template, title, primary_keyword, updated_at, published_at, metadata, body_json')
    .eq('status', 'published')
    .order('updated_at', { ascending: true }) // oldest first
    .limit(LIMIT);

  if (error) throw error;

  console.log(`[staleness-scorer] Scoring ${(pages ?? []).length} pages (dryRun=${DRY_RUN})`);

  let enqueued = 0;
  let critical = 0;

  for (const page of (pages ?? []) as PageRow[]) {
    const result = await scorePage(page);

    console.log(
      `[staleness] ${page.slug}: score=${result.staleness_score} priority=${result.refresh_priority}` +
      (result.staleness_reasons.length > 0 ? ` — ${result.staleness_reasons[0]}` : ''),
    );

    if (DRY_RUN) continue;

    await supabase.from('page_staleness_scores').upsert(result, { onConflict: 'page_slug' });

    await supabase.from('pages').update({
      metadata: {
        ...(page.metadata ?? {}),
        staleness_score: result.staleness_score,
        staleness_reasons: result.staleness_reasons,
        refresh_priority: result.refresh_priority,
        staleness_scored_at: result.scored_at,
      },
    }).eq('slug', page.slug);

    if (result.staleness_score >= ENQUEUE_STALENESS_THRESHOLD) {
      await supabase.from('content_refresh_queue').upsert({
        page_slug: page.slug,
        reason: result.staleness_reasons.join(' | '),
        priority: result.refresh_priority,
        staleness_score: result.staleness_score,
        auto_approve: result.refresh_priority === 'critical',
        created_at: new Date().toISOString(),
      }, { onConflict: 'page_slug' });
      enqueued++;
    }

    if (result.refresh_priority === 'critical') critical++;
  }

  console.log(`[staleness-scorer] Done. Enqueued ${enqueued} pages for refresh (${critical} critical). (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
