/**
 * CTR Optimization Loop
 *
 * Queries page_metrics_daily for pages with position ≤ 10 and CTR < 2.5%
 * over the last 28 days. For each underperforming page, calls GPT-4o to
 * generate 3 alternative title variants with different emotional framing.
 * Stores variants in pages.metadata.title_variants.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const openaiModel = process.env.CODEX_MODEL ?? 'gpt-4o';
const CTR_THRESHOLD = 0.025; // 2.5%
const POSITION_MAX = 10;
const SMART_RING_ONLY = process.argv.includes('--smart-ring-only');

interface MetricRow {
  page_slug: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface PageRow {
  id: string;
  slug: string;
  title: string;
  template: string;
  primary_keyword: string | null;
  metadata: Record<string, unknown> | null;
}

function isSmartRingPage(page: PageRow): boolean {
  const haystack = [
    page.slug,
    page.title,
    page.primary_keyword ?? '',
    String(page.metadata?.market_focus ?? ''),
  ].join(' ').toLowerCase();

  return ['smart ring', 'ringconn', 'oura', 'ultrahuman', 'galaxy ring', 'volo ring', 'wearable ring', 'sleep ring', 'recovery ring']
    .some((term) => haystack.includes(term));
}

async function generateTitleVariants(
  currentTitle: string,
  keyword: string,
  currentCtr: number,
  position: number,
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  const prompt = `You are an SEO title optimization expert. Generate exactly 3 alternative title variants for this underperforming page.

Current title: "${currentTitle}"
Primary keyword: "${keyword}"
Current CTR: ${(currentCtr * 100).toFixed(1)}% (target: >2.5%)
Current SERP position: ${position.toFixed(1)}

Requirements:
- Each title must be ≤60 characters
- Each title must include the primary keyword naturally
- Use different emotional framing for each:
  1. Urgency/FOMO framing
  2. Specificity/data-driven framing
  3. Question framing
- Do NOT use: "groundbreaking", "game-changer", "unleash", "revolutionary"
- Target athletes and performance-focused individuals

Return ONLY a JSON array with exactly 3 strings: ["title1", "title2", "title3"]`;

  try {
    await rateLimit('openai');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      console.warn(`[ctr-optimizer] OpenAI error ${res.status}`);
      return [];
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content as string | undefined;
    if (!text) return [];

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const variants = JSON.parse(match[0]) as string[];
    return Array.isArray(variants)
      ? variants.filter((v) => typeof v === 'string' && v.length <= 65).slice(0, 3)
      : [];
  } catch (err) {
    console.warn('[ctr-optimizer] Error generating variants:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function run() {
  const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Aggregate CTR + position over last 28 days
  const { data: metrics, error: metricsErr } = await supabase
    .from('page_metrics_daily')
    .select('page_slug, clicks, impressions, position')
    .gte('date', since);

  if (metricsErr) throw metricsErr;
  if (!metrics || metrics.length === 0) {
    console.log('[ctr-optimizer] No metrics data found — skipping.');
    return;
  }

  // Aggregate by page_slug
  const aggregated = new Map<string, { totalClicks: number; totalImpressions: number; positionSum: number; count: number }>();
  for (const row of metrics as MetricRow[]) {
    const existing = aggregated.get(row.page_slug) ?? { totalClicks: 0, totalImpressions: 0, positionSum: 0, count: 0 };
    existing.totalClicks += row.clicks;
    existing.totalImpressions += row.impressions;
    existing.positionSum += row.position;
    existing.count += 1;
    aggregated.set(row.page_slug, existing);
  }

  // Filter: position ≤ 10, CTR < threshold, at least 100 impressions
  const underperforming: Array<{ slug: string; ctr: number; position: number }> = [];
  for (const [slug, agg] of aggregated) {
    const avgPosition = agg.positionSum / agg.count;
    if (avgPosition > POSITION_MAX) continue;
    if (agg.totalImpressions < 100) continue;
    const ctr = agg.totalClicks / agg.totalImpressions;
    if (ctr < CTR_THRESHOLD) {
      underperforming.push({ slug, ctr, position: avgPosition });
    }
  }

  underperforming.sort((a, b) => a.ctr - b.ctr);

  console.log(`[ctr-optimizer] Found ${underperforming.length} underperforming pages (position ≤${POSITION_MAX}, CTR <${CTR_THRESHOLD * 100}%)`);

  if (underperforming.length === 0) return;

  // Log top 10 worst offenders
  console.log('\nTop 10 worst CTR pages:');
  underperforming.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.slug} — CTR ${(p.ctr * 100).toFixed(2)}% @ position ${p.position.toFixed(1)}`);
  });

  if (!process.env.OPENAI_API_KEY) {
    console.log('[ctr-optimizer] No OPENAI_API_KEY — skipping variant generation.');
    return;
  }

  // Process top 10 worst performers for title variant generation
  const candidates = underperforming.slice(0, 25);
  const slugs = candidates.map((c) => c.slug);

  const { data: pageRows, error: pageErr } = await supabase
    .from('pages')
    .select('id, slug, title, template, primary_keyword, metadata')
    .in('slug', slugs);

  if (pageErr) throw pageErr;
  if (!pageRows) return;

  const scopedPages = (pageRows as PageRow[]).filter((page) => !SMART_RING_ONLY || isSmartRingPage(page));

  let updated = 0;
  for (const page of scopedPages) {
    const stats = candidates.find((c) => c.slug === page.slug);
    if (!stats) continue;

    const keyword = page.primary_keyword ?? page.title;
    const variants = await generateTitleVariants(page.title, keyword, stats.ctr, stats.position);

    if (variants.length === 0) continue;

    const titleVariants = variants.map((title) => ({ title, generated_at: new Date().toISOString() }));
    const updatedMetadata = { ...(page.metadata ?? {}), title_variants: titleVariants };

    const [{ error: updateErr }, { error: experimentErr }] = await Promise.all([
      supabase.from('pages').update({ metadata: updatedMetadata }).eq('id', page.id),
      supabase.from('page_title_experiments').upsert(
        variants.map((title, index) => ({
          page_id: page.id,
          page_slug: page.slug,
          channel: 'organic_search',
          variant: `ctr-${index + 1}`,
          title,
          score: null,
          status: 'suggested',
          reason: `CTR ${(stats.ctr * 100).toFixed(2)}% at avg position ${stats.position.toFixed(1)}`,
          metrics: {
            current_ctr: stats.ctr,
            current_position: stats.position,
          },
        })),
        { onConflict: 'page_id,channel,variant' } as any,
      ),
    ]);

    if (updateErr || experimentErr) {
      console.warn(
        `[ctr-optimizer] Failed to update ${page.slug}: ${updateErr?.message ?? experimentErr?.message ?? 'unknown error'}`,
      );
    } else {
      updated++;
      console.log(`[ctr-optimizer] Generated ${variants.length} title variants for "${page.title}"`);
      variants.forEach((v, i) => console.log(`  Variant ${i + 1}: ${v}`));
    }
  }

  console.log(`\n[ctr-optimizer] Updated ${updated} page(s) with title variants (scopedPages=${scopedPages.length}).`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
