/**
 * Use-Case Page Splitter
 *
 * Takes broad category keywords and splits them into specific intent
 * sub-pages — the same products, different framing to match how buyers
 * actually search.
 *
 * "smart ring" → "smart ring for women", "smart ring without subscription",
 *   "smart ring for runners", "best smart ring under $300"
 *
 * This multiplies rankable surface area without new inventory. Each
 * sub-page targets a narrower keyword with lower competition and higher
 * purchase intent than the broad head term.
 *
 * Logic:
 *   - Builds category × modifier combinations from taxonomy below
 *   - Validates combinations are semantically coherent (allow-list per category)
 *   - Checks keyword_queue and pages for existing coverage
 *   - Enqueues new pages with template, priority, and brief_context
 *   - Records in use_case_pages tracking table
 *
 * Priority scoring:
 *   base (category DR proxy) + modifier_weight + volume_signal
 *   Higher for: subscription_alternative modifiers (high commercial intent)
 *               price modifiers (bottom-funnel)
 *               gender/demographic modifiers (high CTR)
 *
 * Usage:
 *   npx tsx scripts/use-case-page-splitter.ts
 *   npx tsx scripts/use-case-page-splitter.ts --dry-run
 *   npx tsx scripts/use-case-page-splitter.ts --category="smart ring"
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

// ── Modifier definitions ──────────────────────────────────────────────────────
type Modifier = {
  id: string;
  label: string;            // appended to category: "smart ring {label}"
  prefix?: string;          // prepended instead: "{prefix} smart ring"
  intent: 'demographic' | 'use_case' | 'price' | 'feature' | 'subscription';
  priority_boost: number;   // added to base priority
  template_override?: string;
};

const MODIFIERS: Modifier[] = [
  // Demographic
  { id: 'for-women',      label: 'for women',       intent: 'demographic',    priority_boost: 15 },
  { id: 'for-men',        label: 'for men',          intent: 'demographic',    priority_boost: 10 },
  { id: 'for-athletes',   label: 'for athletes',     intent: 'demographic',    priority_boost: 18 },
  { id: 'for-seniors',    label: 'for seniors',       intent: 'demographic',    priority_boost: 8  },
  { id: 'for-beginners',  label: 'for beginners',    intent: 'demographic',    priority_boost: 12 },
  // Use case
  { id: 'for-sleep',      label: 'for sleep tracking',  intent: 'use_case',   priority_boost: 20 },
  { id: 'for-hrv',        label: 'for HRV tracking',    intent: 'use_case',   priority_boost: 22 },
  { id: 'for-runners',    label: 'for runners',          intent: 'use_case',   priority_boost: 18 },
  { id: 'for-cycling',    label: 'for cycling',          intent: 'use_case',   priority_boost: 12 },
  { id: 'for-swimming',   label: 'for swimming',         intent: 'use_case',   priority_boost: 10 },
  { id: 'for-crossfit',   label: 'for CrossFit',         intent: 'use_case',   priority_boost: 14 },
  { id: 'for-triathletes', label: 'for triathletes',     intent: 'use_case',   priority_boost: 16 },
  { id: 'for-recovery',   label: 'for recovery',         intent: 'use_case',   priority_boost: 20 },
  { id: 'for-travel',     label: 'for travel',           intent: 'use_case',   priority_boost: 8  },
  { id: 'for-anxiety',    label: 'for stress and anxiety', intent: 'use_case', priority_boost: 14 },
  // Price
  { id: 'under-100',      label: 'under $100',       intent: 'price',          priority_boost: 20, template_override: 'guides' },
  { id: 'under-200',      label: 'under $200',       intent: 'price',          priority_boost: 22, template_override: 'guides' },
  { id: 'under-300',      label: 'under $300',       intent: 'price',          priority_boost: 20, template_override: 'guides' },
  { id: 'under-500',      label: 'under $500',       intent: 'price',          priority_boost: 15, template_override: 'guides' },
  { id: 'budget',         label: 'budget',           intent: 'price',          priority_boost: 18, template_override: 'guides' },
  { id: 'cheap',          label: 'cheap',            intent: 'price',          priority_boost: 15, template_override: 'guides' },
  // Feature
  { id: 'waterproof',     label: 'waterproof',       intent: 'feature',        priority_boost: 12 },
  { id: 'long-battery',   label: 'with longest battery life', intent: 'feature', priority_boost: 14 },
  { id: 'accurate',       label: 'most accurate',    intent: 'feature',        priority_boost: 16, prefix: 'most accurate' },
  { id: 'lightweight',    label: 'lightweight',      intent: 'feature',        priority_boost: 10 },
  // Subscription alternatives — very high commercial intent
  { id: 'no-subscription', label: 'without subscription', intent: 'subscription', priority_boost: 25 },
  { id: 'no-monthly-fee',  label: 'with no monthly fee',  intent: 'subscription', priority_boost: 25 },
  { id: 'one-time-payment', label: 'one time payment',    intent: 'subscription', priority_boost: 22 },
  // Health outcomes — buyers searching these have clear purchase intent
  { id: 'for-cycle-tracking',  label: 'for cycle tracking',          intent: 'use_case', priority_boost: 18 },
  { id: 'for-blood-oxygen',    label: 'for blood oxygen monitoring',  intent: 'use_case', priority_boost: 14 },
  { id: 'for-heart-rate',      label: 'for heart rate monitoring',   intent: 'use_case', priority_boost: 12 },
  { id: 'for-weight-loss',     label: 'for weight loss',             intent: 'use_case', priority_boost: 16 },
  { id: 'for-stress',          label: 'for stress management',       intent: 'use_case', priority_boost: 15 },
  // Feature / form factor
  { id: 'titanium',            label: 'titanium',                    intent: 'feature',  priority_boost: 13 },
  { id: 'smallest',            label: 'smallest',                    intent: 'feature',  priority_boost: 12, prefix: 'smallest' },
];

// ── Category definitions ──────────────────────────────────────────────────────
type CategoryDef = {
  id: string;
  head_term: string;           // the broad keyword
  plural: string;              // used in titles: "best smart rings for..."
  template: string;            // default template for sub-pages
  base_priority: number;
  allowed_modifier_ids: string[];  // which modifiers make semantic sense
  cluster: string;
};

const CATEGORIES: CategoryDef[] = [
  {
    id: 'smart-ring',
    head_term: 'smart ring',
    plural: 'smart rings',
    template: 'guides',
    base_priority: 70,
    cluster: 'smart-rings',
    allowed_modifier_ids: [
      'for-women', 'for-men', 'for-athletes', 'for-sleep', 'for-hrv',
      'for-runners', 'for-cycling', 'for-crossfit', 'for-swimming', 'for-triathletes', 'for-recovery',
      'for-travel', 'for-anxiety', 'for-beginners', 'for-seniors',
      'for-cycle-tracking', 'for-blood-oxygen', 'for-heart-rate', 'for-weight-loss', 'for-stress',
      'under-200', 'under-300', 'under-500', 'budget',
      'waterproof', 'long-battery', 'accurate', 'lightweight', 'titanium', 'smallest',
      'no-subscription', 'no-monthly-fee', 'one-time-payment',
    ],
  },
  {
    id: 'recovery-wearable',
    head_term: 'recovery wearable',
    plural: 'recovery wearables',
    template: 'guides',
    base_priority: 68,
    cluster: 'recovery-wearables',
    allowed_modifier_ids: [
      'for-women', 'for-men', 'for-athletes', 'for-runners', 'for-cycling',
      'for-crossfit', 'for-triathletes', 'for-hrv', 'for-sleep', 'for-recovery',
      'under-200', 'under-300', 'budget',
      'no-subscription', 'no-monthly-fee',
      'accurate', 'waterproof', 'long-battery',
    ],
  },
  {
    id: 'hrv-monitor',
    head_term: 'HRV monitor',
    plural: 'HRV monitors',
    template: 'metrics',
    base_priority: 65,
    cluster: 'hrv-tracking',
    allowed_modifier_ids: [
      'for-athletes', 'for-runners', 'for-crossfit', 'for-triathletes',
      'for-women', 'for-beginners',
      'under-100', 'under-200', 'budget',
      'accurate', 'waterproof',
      'no-subscription',
    ],
  },
  {
    id: 'sleep-tracker',
    head_term: 'sleep tracker',
    plural: 'sleep trackers',
    template: 'guides',
    base_priority: 72,
    cluster: 'sleep-tracking',
    allowed_modifier_ids: [
      'for-women', 'for-men', 'for-seniors', 'for-beginners', 'for-athletes',
      'for-anxiety', 'for-travel', 'for-cycle-tracking', 'for-stress',
      'under-100', 'under-200', 'under-300', 'budget', 'cheap',
      'accurate', 'waterproof', 'long-battery',
      'no-subscription', 'no-monthly-fee',
    ],
  },
  {
    id: 'percussion-massager',
    head_term: 'percussion massager',
    plural: 'percussion massagers',
    template: 'guides',
    base_priority: 62,
    cluster: 'percussion-therapy',
    allowed_modifier_ids: [
      'for-athletes', 'for-runners', 'for-crossfit', 'for-recovery',
      'for-women', 'for-seniors', 'for-beginners',
      'under-100', 'under-200', 'budget', 'cheap',
      'lightweight', 'waterproof',
    ],
  },
  {
    id: 'massage-gun',
    head_term: 'massage gun',
    plural: 'massage guns',
    template: 'guides',
    base_priority: 65,
    cluster: 'percussion-therapy',
    allowed_modifier_ids: [
      'for-athletes', 'for-runners', 'for-crossfit', 'for-recovery',
      'for-women', 'for-seniors', 'for-beginners', 'for-travel',
      'under-100', 'under-200', 'budget', 'cheap',
      'lightweight', 'accurate',
    ],
  },
  {
    id: 'compression-boots',
    head_term: 'compression boots',
    plural: 'compression boots',
    template: 'guides',
    base_priority: 58,
    cluster: 'compression-therapy',
    allowed_modifier_ids: [
      'for-athletes', 'for-runners', 'for-cycling', 'for-triathletes', 'for-recovery',
      'for-women', 'for-seniors',
      'under-300', 'under-500', 'budget',
    ],
  },
  {
    id: 'red-light-therapy',
    head_term: 'red light therapy device',
    plural: 'red light therapy devices',
    template: 'guides',
    base_priority: 60,
    cluster: 'light-therapy',
    allowed_modifier_ids: [
      'for-women', 'for-men', 'for-recovery', 'for-athletes', 'for-seniors',
      'for-anxiety', 'for-sleep',
      'under-100', 'under-200', 'under-300', 'budget',
      'lightweight',
    ],
  },
  {
    id: 'cold-plunge',
    head_term: 'cold plunge',
    plural: 'cold plunges',
    template: 'guides',
    base_priority: 64,
    cluster: 'cold-therapy',
    allowed_modifier_ids: [
      'for-athletes', 'for-beginners', 'for-recovery', 'for-women',
      'under-300', 'under-500', 'budget',
      'for-home',
    ],
  },
  {
    id: 'fitness-tracker',
    head_term: 'fitness tracker',
    plural: 'fitness trackers',
    template: 'guides',
    base_priority: 60,
    cluster: 'fitness-tracking',
    allowed_modifier_ids: [
      'for-women', 'for-men', 'for-seniors', 'for-beginners', 'for-athletes',
      'for-runners', 'for-swimming', 'for-sleep', 'for-hrv',
      'under-100', 'under-200', 'budget', 'cheap',
      'waterproof', 'long-battery', 'accurate',
      'no-subscription',
    ],
  },
];

// ── Slug + title builders ─────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 90);
}

function buildKeyword(cat: CategoryDef, mod: Modifier): string {
  if (mod.prefix) return `${mod.prefix} ${cat.head_term}`;
  return `best ${cat.plural} ${mod.label}`;
}

function buildTitle(cat: CategoryDef, mod: Modifier): string {
  if (mod.prefix) return `${mod.prefix.charAt(0).toUpperCase() + mod.prefix.slice(1)} ${cat.head_term.charAt(0).toUpperCase() + cat.head_term.slice(1)} in ${CURRENT_YEAR}`;
  if (mod.intent === 'price') return `Best ${cat.plural.charAt(0).toUpperCase() + cat.plural.slice(1)} ${mod.label} in ${CURRENT_YEAR} (Tested)`;
  return `Best ${cat.plural.charAt(0).toUpperCase() + cat.plural.slice(1)} ${mod.label} in ${CURRENT_YEAR}`;
}

function buildMetaDescription(cat: CategoryDef, mod: Modifier, keyword: string): string {
  if (mod.intent === 'price') {
    return `The best ${cat.head_term} ${mod.label} — we tested every option and ranked by accuracy, comfort, and value. No fluff, just results.`;
  }
  if (mod.intent === 'subscription') {
    return `Best ${cat.plural} ${mod.label}. Compare top options, features, and pricing — all without a recurring fee.`;
  }
  if (mod.intent === 'demographic') {
    return `The best ${cat.plural} ${mod.label} in ${CURRENT_YEAR} — ranked by ${mod.id === 'for-seniors' ? 'ease of use and readability' : mod.id === 'for-women' ? 'accuracy, form factor, and cycle tracking' : 'performance metrics and durability'}.`;
  }
  return `Best ${cat.plural} ${mod.label} — tested and ranked by ${cat.id.includes('hrv') ? 'HRV accuracy and sensor quality' : 'accuracy, battery life, and value'}. Updated ${CURRENT_YEAR}.`;
}

function buildBriefContext(cat: CategoryDef, mod: Modifier, keyword: string): Record<string, unknown> {
  return {
    category: cat.head_term,
    modifier: mod.label,
    modifier_intent: mod.intent,
    cluster: cat.cluster,
    content_angle: mod.intent === 'subscription'
      ? 'lead with the subscription-free angle — buyers searching this are actively avoiding recurring fees'
      : mod.intent === 'price'
      ? 'lead with value proposition — include specific price points in the first paragraph'
      : mod.intent === 'demographic'
      ? `write specifically for ${mod.label.replace('for ', '')} — tailor form factor, use case framing, and examples`
      : `focus on ${mod.label.replace('for ', '')} specific requirements — what features matter for this use case vs others`,
    required_sections: [
      `What makes a great ${cat.head_term} ${mod.label}`,
      'Top picks compared',
      'Best overall pick',
      mod.intent === 'price' ? 'Best value pick' : 'Best premium pick',
      'Feature comparison table',
      'What to avoid',
      'Our verdict',
    ],
    source: 'use_case_splitter',
  };
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
  cat: CategoryDef,
  mod: Modifier,
  keyword: string,
  slug: string,
): Promise<void> {
  const title = buildTitle(cat, mod);
  const meta = buildMetaDescription(cat, mod, keyword);
  const template = mod.template_override ?? cat.template;
  const priority = cat.base_priority + mod.priority_boost;
  const briefContext = buildBriefContext(cat, mod, keyword);

  await supabase.from('keyword_queue').upsert({
    slug,
    keyword,
    template,
    title,
    meta_description: meta,
    priority,
    status: 'pending',
    source: 'use_case_splitter',
    metadata: { brief_context: briefContext, category_id: cat.id, modifier_id: mod.id },
  }, { onConflict: 'slug' });

  await supabase.from('use_case_pages').upsert({
    slug,
    category_id: cat.id,
    modifier_id: mod.id,
    primary_keyword: keyword,
    template,
    priority,
    status: 'queued',
    generated_at: new Date().toISOString(),
  }, { onConflict: 'slug' });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  const categories = TARGET_CATEGORY
    ? CATEGORIES.filter((c) => c.head_term.toLowerCase().includes(TARGET_CATEGORY.toLowerCase()) || c.id === TARGET_CATEGORY)
    : CATEGORIES;

  if (categories.length === 0) {
    console.log(`[use-case-splitter] No category matching "${TARGET_CATEGORY}"`);
    return;
  }

  let totalQueued = 0;
  let totalSkipped = 0;

  for (const cat of categories) {
    const allowedModifiers = MODIFIERS.filter((m) => cat.allowed_modifier_ids.includes(m.id));
    let catQueued = 0;

    for (const mod of allowedModifiers) {
      const keyword = buildKeyword(cat, mod);
      const slug = slugify(keyword);

      const exists = await slugExists(slug);
      if (exists) {
        totalSkipped++;
        continue;
      }

      console.log(`[use-case-splitter] ${cat.head_term} × ${mod.label}: "${keyword}"`);

      if (!DRY_RUN) {
        await enqueue(cat, mod, keyword, slug);
      }
      catQueued++;
      totalQueued++;
    }

    console.log(`[use-case-splitter] ${cat.head_term}: ${catQueued} queued, ${allowedModifiers.length - catQueued} skipped`);
  }

  console.log(`[use-case-splitter] Done. ${totalQueued} queued, ${totalSkipped} already exist (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
