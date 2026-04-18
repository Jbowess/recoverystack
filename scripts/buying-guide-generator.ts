/**
 * Buying Guide Generator
 *
 * Targets buying-guide-intent keywords at scale — the format Dave Fogerty
 * calls out specifically as "earns backlinks over time in a way topical
 * posts don't."
 *
 * These pages sit at the top of the funnel (researching buyers) and channel
 * authority down to money pages (reviews, alternatives, comparisons) through
 * internal links. They also rank in AI overviews because they directly answer
 * "how do I choose X" questions with structured, specific criteria.
 *
 * Keyword patterns targeted:
 *   "[category] buying guide [year]"
 *   "how to choose the best [category]"
 *   "what to look for in a [category]"
 *   "complete guide to [category]"
 *   "[category] guide for beginners"
 *   "[category] vs [category]: which should you buy"  (cross-category)
 *
 * Page structure (baked into brief_context):
 *   1. Quick answer (GEO-optimised, direct 50-word answer)
 *   2. Who this guide is for
 *   3. Key specs explained (demystify the jargon)
 *   4. Must-have features vs nice-to-haves
 *   5. Price tiers explained
 *   6. Our top picks (3–5, links to review pages)
 *   7. What to avoid
 *   8. FAQ
 *
 * Usage:
 *   npx tsx scripts/buying-guide-generator.ts
 *   npx tsx scripts/buying-guide-generator.ts --dry-run
 *   npx tsx scripts/buying-guide-generator.ts --category="smart ring"
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const TARGET_CATEGORY = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1] ?? null;
const CURRENT_YEAR = new Date().getFullYear();

// ── Guide pattern definitions ─────────────────────────────────────────────────
type GuidePattern = {
  id: string;
  keyword_template: (cat: GuideCategoryDef) => string;
  title_template: (cat: GuideCategoryDef) => string;
  meta_template: (cat: GuideCategoryDef) => string;
  intent: string;
  priority_boost: number;
  required_sections: (cat: GuideCategoryDef) => string[];
  content_angle: string;
};

const GUIDE_PATTERNS: GuidePattern[] = [
  {
    id: 'buying-guide-year',
    keyword_template: (c) => `${c.head_term} buying guide ${CURRENT_YEAR}`,
    title_template: (c) => `${c.display_name} Buying Guide ${CURRENT_YEAR}: Everything You Need to Know`,
    meta_template: (c) => `The complete ${c.head_term} buying guide for ${CURRENT_YEAR}. We explain every spec that matters, the price tiers, and exactly which ${c.head_term} to buy for your situation.`,
    intent: 'researching buyer — pre-decision, wants to understand the category before committing',
    priority_boost: 25,
    content_angle: 'teach the category from scratch — assume zero prior knowledge. Use plain language. End every section with a specific recommendation.',
    required_sections: (c) => [
      `Quick answer: which ${c.head_term} should you buy?`,
      `What is a ${c.head_term}? (plain language)`,
      'The specs that actually matter (and which to ignore)',
      'Price tiers explained',
      'Must-have features vs nice-to-haves',
      `Our top ${c.head_term} picks for ${CURRENT_YEAR}`,
      'What to avoid',
      'Frequently asked questions',
    ],
  },
  {
    id: 'how-to-choose',
    keyword_template: (c) => `how to choose the best ${c.head_term}`,
    title_template: (c) => `How to Choose the Best ${c.display_name} (${CURRENT_YEAR} Guide)`,
    meta_template: (c) => `Struggling to choose a ${c.head_term}? This guide covers the 5 questions to ask before buying, what specs actually matter, and which ${c.plural} to shortlist.`,
    intent: 'active comparison — has done initial research, now overwhelmed by choices',
    priority_boost: 22,
    content_angle: 'frame as a decision framework, not a review — give them a process to follow, not just a list of products',
    required_sections: (c) => [
      '5 questions to ask before buying',
      `${c.display_name} types: which category fits you?`,
      'The decision matrix: rank your priorities',
      'Red flags to watch for',
      'Our shortlist by use case',
      `How to test a ${c.head_term} before committing`,
    ],
  },
  {
    id: 'what-to-look-for',
    keyword_template: (c) => `what to look for in a ${c.head_term}`,
    title_template: (c) => `What to Look for in a ${c.display_name}: ${CURRENT_YEAR} Checklist`,
    meta_template: (c) => `Not sure what to look for in a ${c.head_term}? We break down the 7 key criteria, which specs are marketing fluff, and what our experts check first.`,
    intent: 'specific criteria search — wants a checklist, not a review',
    priority_boost: 18,
    content_angle: 'lead with the checklist in the first 200 words — make it skimmable and specific. Use numbers wherever possible.',
    required_sections: (c) => [
      `The ${c.head_term} checklist (quick reference)`,
      'Criterion 1: accuracy and sensor quality',
      'Criterion 2: battery life and charging',
      'Criterion 3: app and data quality',
      'Criterion 4: comfort and form factor',
      'Criterion 5: price and ongoing costs',
      'Criterion 6: compatibility',
      `Green flags and red flags at a glance`,
    ],
  },
  {
    id: 'complete-guide',
    keyword_template: (c) => `complete guide to ${c.plural}`,
    title_template: (c) => `The Complete Guide to ${c.display_plural} (${CURRENT_YEAR})`,
    meta_template: (c) => `Everything you need to know about ${c.plural}: how they work, what they measure, which to buy, and how to get the most from your data. Updated ${CURRENT_YEAR}.`,
    intent: 'deep research — wants to understand the technology, not just pick a product',
    priority_boost: 20,
    content_angle: 'write like a sports scientist explaining to an interested layperson — go deep on mechanisms, not just specs. This is the page that earns backlinks.',
    required_sections: (c) => [
      `How ${c.plural} work`,
      `What ${c.plural} actually measure`,
      'The science behind the data',
      'Accuracy: what research says',
      'How to interpret your data',
      `${c.display_name} types and their differences`,
      'Our top recommendations',
      'Common mistakes and how to avoid them',
    ],
  },
  {
    id: 'beginners-guide',
    keyword_template: (c) => `${c.head_term} guide for beginners`,
    title_template: (c) => `${c.display_name} Guide for Beginners: Start Here (${CURRENT_YEAR})`,
    meta_template: (c) => `New to ${c.plural}? This beginner's guide explains what they do, whether you need one, what to expect in your first 30 days, and which model to start with.`,
    intent: 'first-time buyer — uncertain about the category, needs reassurance and simplicity',
    priority_boost: 15,
    content_angle: 'remove anxiety from the purchase. Be honest about limitations. Emphasise ease of getting started over technical capability.',
    required_sections: (c) => [
      `Do you actually need a ${c.head_term}?`,
      `What a ${c.head_term} can and can't do`,
      'Your first 30 days: what to expect',
      'The best starting models (simple, not cheapest)',
      'Common beginner mistakes',
      'How to get value from your data without obsessing',
      'When to upgrade',
    ],
  },
];

// ── Category definitions ──────────────────────────────────────────────────────
type GuideCategoryDef = {
  id: string;
  head_term: string;
  plural: string;
  display_name: string;
  display_plural: string;
  cluster: string;
  base_priority: number;
  allowed_pattern_ids: string[];
  key_spec_terms: string[];   // used in brief context to guide spec explanations
  price_tiers: { label: string; range: string; who_for: string }[];
};

const GUIDE_CATEGORIES: GuideCategoryDef[] = [
  {
    id: 'smart-ring',
    head_term: 'smart ring',
    plural: 'smart rings',
    display_name: 'Smart Ring',
    display_plural: 'Smart Rings',
    cluster: 'smart-rings',
    base_priority: 72,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'complete-guide', 'beginners-guide'],
    key_spec_terms: ['HRV accuracy', 'SpO2', 'skin temperature', 'readiness score', 'battery life (days)', 'water resistance rating', 'form factor (g)', 'subscription cost'],
    price_tiers: [
      { label: 'Budget', range: '$150–$250', who_for: 'sleep and step tracking, no HRV' },
      { label: 'Mid-range', range: '$250–$350', who_for: 'HRV + readiness score, most users' },
      { label: 'Premium', range: '$350+', who_for: 'advanced athletes, medical-grade sensors' },
    ],
  },
  {
    id: 'recovery-wearable',
    head_term: 'recovery wearable',
    plural: 'recovery wearables',
    display_name: 'Recovery Wearable',
    display_plural: 'Recovery Wearables',
    cluster: 'recovery-wearables',
    base_priority: 68,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'complete-guide', 'beginners-guide'],
    key_spec_terms: ['HRV measurement method', 'readiness/recovery score', 'strain tracking', 'sleep staging accuracy', 'sensor type (PPG vs ECG)', 'subscription model'],
    price_tiers: [
      { label: 'Entry', range: '$0 + $30/month', who_for: 'strain-focused athletes (WHOOP model)' },
      { label: 'Mid', range: '$200–$350 + optional sub', who_for: 'balanced recovery + sleep tracking' },
      { label: 'Premium', range: '$400–$700', who_for: 'multimodal tracking, no ongoing fees' },
    ],
  },
  {
    id: 'massage-gun',
    head_term: 'massage gun',
    plural: 'massage guns',
    display_name: 'Massage Gun',
    display_plural: 'Massage Guns',
    cluster: 'percussion-therapy',
    base_priority: 66,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'beginners-guide'],
    key_spec_terms: ['stall force (lbs)', 'amplitude (mm)', 'speed settings (RPM)', 'noise level (dB)', 'battery life (hrs)', 'attachments', 'weight (kg)'],
    price_tiers: [
      { label: 'Budget', range: '$50–$100', who_for: 'casual use, light muscle soreness' },
      { label: 'Mid-range', range: '$100–$250', who_for: 'regular training, most athletes' },
      { label: 'Professional', range: '$250–$600', who_for: 'clinical use, high stall force needed' },
    ],
  },
  {
    id: 'sleep-tracker',
    head_term: 'sleep tracker',
    plural: 'sleep trackers',
    display_name: 'Sleep Tracker',
    display_plural: 'Sleep Trackers',
    cluster: 'sleep-tracking',
    base_priority: 74,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'complete-guide', 'beginners-guide'],
    key_spec_terms: ['sleep staging accuracy', 'SpO2 detection', 'skin temperature', 'HRV overnight', 'smart alarm', 'subscription cost', 'form factor'],
    price_tiers: [
      { label: 'Budget', range: '$20–$80', who_for: 'basic sleep duration and disturbance tracking' },
      { label: 'Mid-range', range: '$80–$300', who_for: 'sleep stages, HRV, actionable coaching' },
      { label: 'Premium', range: '$300+', who_for: 'medical-grade accuracy, sleep apnea screening' },
    ],
  },
  {
    id: 'compression-recovery',
    head_term: 'compression recovery system',
    plural: 'compression recovery systems',
    display_name: 'Compression Recovery System',
    display_plural: 'Compression Recovery Systems',
    cluster: 'compression-therapy',
    base_priority: 58,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'beginners-guide'],
    key_spec_terms: ['pressure range (mmHg)', 'number of chambers', 'session duration', 'portability', 'coverage (legs/hips/arms)', 'inflation speed'],
    price_tiers: [
      { label: 'Entry', range: '$200–$400', who_for: 'occasional use, recreational athletes' },
      { label: 'Mid', range: '$400–$800', who_for: 'regular training blocks, endurance athletes' },
      { label: 'Professional', range: '$800+', who_for: 'clinical or elite sport use' },
    ],
  },
  {
    id: 'hrv-monitor',
    head_term: 'HRV monitor',
    plural: 'HRV monitors',
    display_name: 'HRV Monitor',
    display_plural: 'HRV Monitors',
    cluster: 'hrv-tracking',
    base_priority: 64,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'complete-guide'],
    key_spec_terms: ['measurement method (ECG vs PPG)', 'RMSSD accuracy', 'morning vs overnight HRV', 'baseline calculation period', 'app HRV coaching', 'chest strap vs wrist vs ring'],
    price_tiers: [
      { label: 'Chest strap', range: '$50–$150', who_for: 'highest accuracy, athletes training seriously' },
      { label: 'Wrist/ring', range: '$150–$400', who_for: 'convenience + accuracy balance' },
      { label: 'Premium all-in-one', range: '$400+', who_for: 'full recovery ecosystem' },
    ],
  },
  {
    id: 'red-light-therapy',
    head_term: 'red light therapy device',
    plural: 'red light therapy devices',
    display_name: 'Red Light Therapy Device',
    display_plural: 'Red Light Therapy Devices',
    cluster: 'light-therapy',
    base_priority: 60,
    allowed_pattern_ids: ['buying-guide-year', 'how-to-choose', 'what-to-look-for', 'beginners-guide'],
    key_spec_terms: ['wavelength (nm)', 'irradiance (mW/cm²)', 'coverage area', 'near-infrared vs red light', 'EMF levels', 'treatment distance', 'session time'],
    price_tiers: [
      { label: 'Handheld', range: '$50–$150', who_for: 'targeted spot treatment, travel' },
      { label: 'Panel', range: '$150–$500', who_for: 'full-body treatment, home use' },
      { label: 'Professional panel', range: '$500+', who_for: 'clinical-grade irradiance, large coverage' },
    ],
  },
];

// ── Slug builder ──────────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 90);
}

// ── Existence check ───────────────────────────────────────────────────────────
async function slugExists(slug: string): Promise<boolean> {
  const [{ data: page }, { data: queued }] = await Promise.all([
    supabase.from('pages').select('slug').eq('slug', slug).maybeSingle(),
    supabase.from('keyword_queue').select('slug').eq('slug', slug).maybeSingle(),
  ]);
  return !!(page || queued);
}

// ── Enqueue ───────────────────────────────────────────────────────────────────
async function enqueue(
  cat: GuideCategoryDef,
  pattern: GuidePattern,
  slug: string,
): Promise<void> {
  const keyword = pattern.keyword_template(cat);
  const title = pattern.title_template(cat);
  const meta = pattern.meta_template(cat);
  const priority = cat.base_priority + pattern.priority_boost;

  const briefContext = {
    category: cat.head_term,
    category_id: cat.id,
    pattern: pattern.id,
    cluster: cat.cluster,
    intent: pattern.intent,
    content_angle: pattern.content_angle,
    required_sections: pattern.required_sections(cat),
    key_spec_terms: cat.key_spec_terms,
    price_tiers: cat.price_tiers,
    internal_link_targets: [
      `link to top review pages for ${cat.head_term}`,
      `link to alternatives page for ${cat.head_term}`,
      `link to use-case sub-pages within ${cat.cluster} cluster`,
    ],
    geo_optimise: true,
    source: 'buying_guide_generator',
  };

  await supabase.from('keyword_queue').upsert({
    slug,
    keyword,
    template: 'guides',
    title,
    meta_description: meta,
    priority,
    status: 'pending',
    source: 'buying_guide_generator',
    metadata: { brief_context: briefContext, pattern_id: pattern.id, category_id: cat.id },
  }, { onConflict: 'slug' });

  await supabase.from('buying_guide_pages').upsert({
    slug,
    category_id: cat.id,
    pattern_id: pattern.id,
    primary_keyword: keyword,
    priority,
    status: 'queued',
    generated_at: new Date().toISOString(),
  }, { onConflict: 'slug' });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  const categories = TARGET_CATEGORY
    ? GUIDE_CATEGORIES.filter(
        (c) => c.head_term.toLowerCase().includes(TARGET_CATEGORY.toLowerCase()) || c.id === TARGET_CATEGORY,
      )
    : GUIDE_CATEGORIES;

  if (categories.length === 0) {
    console.log(`[buying-guides] No category matching "${TARGET_CATEGORY}"`);
    return;
  }

  let totalQueued = 0;
  let totalSkipped = 0;

  for (const cat of categories) {
    const allowedPatterns = GUIDE_PATTERNS.filter((p) => cat.allowed_pattern_ids.includes(p.id));
    let catQueued = 0;

    for (const pattern of allowedPatterns) {
      const keyword = pattern.keyword_template(cat);
      const slug = slugify(keyword);

      const exists = await slugExists(slug);
      if (exists) {
        totalSkipped++;
        continue;
      }

      console.log(`[buying-guides] ${cat.display_name} × ${pattern.id}: "${keyword}"`);

      if (!DRY_RUN) {
        await enqueue(cat, pattern, slug);
      }
      catQueued++;
      totalQueued++;
    }

    console.log(`[buying-guides] ${cat.display_name}: ${catQueued} queued, ${allowedPatterns.length - catQueued} already exist`);
  }

  console.log(`[buying-guides] Done. ${totalQueued} queued, ${totalSkipped} skipped (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
