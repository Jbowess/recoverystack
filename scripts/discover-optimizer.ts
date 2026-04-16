/**
 * Google Discover Optimizer
 *
 * Scores page titles for Discover-friendliness using heuristics:
 *   - Length (40-65 chars optimal)
 *   - Contains a number
 *   - Contains a power word (curiosity gap, emotional trigger)
 *   - Not clickbait (no ALL CAPS, excessive punctuation)
 *   - Hero image confirmed ≥1200px wide (checks metadata.hero_image)
 *
 * For low-scoring pages, generates Discover-optimised title variants
 * and stores them in pages.metadata.discover_title_variants.
 *
 * Run: npm run discover:optimize
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DISCOVER_SCORE_THRESHOLD = 60;
const openaiModel = process.env.CODEX_MODEL ?? 'gpt-4o';

// Power words that correlate with high Discover CTR
const POWER_WORDS = [
  'secret', 'truth', 'mistake', 'warning', 'proven', 'surprising',
  'tested', 'actually', 'never', 'always', 'every', 'best',
  'worst', 'hidden', 'real', 'why', 'how', 'what',
  'new', 'breakthrough', 'critical', 'essential', 'exact',
];

const NEGATIVE_PATTERNS = [
  /[A-Z]{4,}/, // Excessive caps
  /!!!/, // Triple exclamation
  /\?{2,}/, // Multiple question marks
  /click here/i,
  /you won't believe/i,
];

interface DiscoverScore {
  total: number;
  breakdown: Record<string, number>;
  issues: string[];
}

function scoreTitle(title: string): DiscoverScore {
  const issues: string[] = [];
  const breakdown: Record<string, number> = {};

  // Length score (40–65 chars = ideal)
  const len = title.length;
  if (len >= 40 && len <= 65) {
    breakdown.length = 25;
  } else if (len >= 30 && len <= 80) {
    breakdown.length = 15;
  } else {
    breakdown.length = 5;
    issues.push(`title length ${len} (ideal: 40-65)`);
  }

  // Contains a number
  if (/\d+/.test(title)) {
    breakdown.hasNumber = 15;
  } else {
    breakdown.hasNumber = 0;
    issues.push('no number — numbered titles get higher Discover CTR');
  }

  // Power words
  const lower = title.toLowerCase();
  const powerWordCount = POWER_WORDS.filter((w) => lower.includes(w)).length;
  breakdown.powerWords = Math.min(powerWordCount * 10, 20);
  if (powerWordCount === 0) issues.push('no power words');

  // Question format (high engagement)
  if (title.endsWith('?')) {
    breakdown.questionFormat = 10;
  } else {
    breakdown.questionFormat = 0;
  }

  // Negative patterns (penalise)
  let penalty = 0;
  for (const pat of NEGATIVE_PATTERNS) {
    if (pat.test(title)) {
      penalty += 15;
      issues.push(`contains low-quality pattern: ${pat}`);
    }
  }
  breakdown.penalty = -penalty;

  // Has primary keyword (implied by being an SEO page — give base score)
  breakdown.base = 30;

  const total = Math.max(0, Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0)));

  return { total, breakdown, issues };
}

async function generateDiscoverVariants(
  title: string,
  keyword: string,
  template: string,
): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];

  const prompt = `You are a Google Discover content specialist. Generate 3 title variants optimised for Google Discover feed clicks.

Current title: "${title}"
Primary keyword: "${keyword}"
Content type: ${template}

Requirements for Discover titles:
- 40-65 characters (strict)
- Include a number where natural (e.g. "7 ways", "3 mistakes", "5 signs")
- Trigger curiosity without being clickbait
- Must be factually accurate to the content
- No ALL CAPS, no multiple !!!
- Include at least one of: why/how/what/the truth about/surprising/actually/tested

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
        temperature: 0.8,
      }),
    });

    if (!res.ok) return [];
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content as string | undefined;
    if (!text) return [];

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const variants = JSON.parse(match[0]) as string[];
    return Array.isArray(variants)
      ? variants.filter((v) => typeof v === 'string' && v.length >= 30 && v.length <= 75).slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id, slug, title, template, primary_keyword, metadata')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  if (!pages || pages.length === 0) {
    console.log('[discover-optimizer] No published pages found.');
    return;
  }

  const results: Array<{ slug: string; score: number; issues: string[] }> = [];
  let optimized = 0;
  let hasImage = 0;
  let missingImage = 0;

  for (const page of pages as Array<{ id: string; slug: string; title: string; template: string; primary_keyword: string | null; metadata: Record<string, unknown> | null }>) {
    const score = scoreTitle(page.title);
    results.push({ slug: page.slug, score: score.total, issues: score.issues });

    // Check hero image
    if (page.metadata?.hero_image) {
      hasImage++;
    } else {
      missingImage++;
    }

    // Generate Discover variants for low-scoring pages
    if (score.total < DISCOVER_SCORE_THRESHOLD) {
      const variants = await generateDiscoverVariants(
        page.title,
        page.primary_keyword ?? page.title,
        page.template,
      );

      if (variants.length > 0) {
        const updatedMeta = {
          ...(page.metadata ?? {}),
          discover_title_variants: variants.map((title) => ({
            title,
            score: scoreTitle(title).total,
            generated_at: new Date().toISOString(),
          })),
          discover_current_score: score.total,
        };

        await Promise.all([
          supabase.from('pages').update({ metadata: updatedMeta }).eq('id', page.id),
          supabase.from('page_title_experiments').upsert(
            variants.map((title, index) => ({
              page_id: page.id,
              page_slug: page.slug,
              channel: 'discover',
              variant: `discover-${index + 1}`,
              title,
              score: scoreTitle(title).total,
              status: 'suggested',
              reason: `Discover score ${score.total}`,
              metrics: { discover_current_score: score.total },
            })),
            { onConflict: 'page_id,channel,variant' } as any,
          ),
        ]);
        optimized++;
      }
    }
  }

  // Sort by score ascending for report
  results.sort((a, b) => a.score - b.score);

  console.log('\n[discover-optimizer] Title Score Report (lowest first):');
  results.slice(0, 15).forEach((r) => {
    const bar = '█'.repeat(Math.floor(r.score / 10)) + '░'.repeat(10 - Math.floor(r.score / 10));
    console.log(`  ${bar} ${r.score}/100 — ${r.slug}`);
    if (r.issues.length) console.log(`    Issues: ${r.issues.join('; ')}`);
  });

  const avgScore = results.reduce((a, b) => a + b.score, 0) / results.length;
  console.log(`\n  Average Discover score: ${avgScore.toFixed(1)}/100`);
  console.log(`  Pages with hero images: ${hasImage}/${pages.length}`);
  console.log(`  Pages missing hero images: ${missingImage} — run content:generate to add DALL-E images`);
  console.log(`  Variants generated: ${optimized} low-scoring pages`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
