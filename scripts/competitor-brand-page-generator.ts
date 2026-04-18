/**
 * Competitor Brand Page Generator
 *
 * Programmatically generates high-intent bottom-funnel pages targeting
 * competitor brand search terms. These pages capture buyers actively
 * researching alternatives to known brands.
 *
 * Four page types generated per competitor:
 *   1. alternatives — "Best alternatives to [Competitor]"
 *      Targets: "[competitor] alternative", "best [competitor] alternatives"
 *   2. vs_comparison — "[Competitor] vs [Our Brand / Category Leader]"
 *      Targets: "[competitor] vs [brand]", "compare [competitor]"
 *   3. use_case — "Best [Category] for [Use Case]" (outflanks competitor's owned terms)
 *      Targets: competitor's category with intent modifier
 *   4. review_vs — "[Competitor] review: is it worth it in [year]?"
 *      Targets: "[competitor] review", "[competitor] worth it"
 *
 * Logic:
 *   - Only creates pages that don't already exist in `pages` or `keyword_queue`
 *   - Assigns priority based on competitor domain rating + search volume estimate
 *   - Uses brief-generator compatible brief structure so content-generator picks up
 *   - Inserts into keyword_queue with template and priority pre-assigned
 *
 * Usage:
 *   npx tsx scripts/competitor-brand-page-generator.ts
 *   npx tsx scripts/competitor-brand-page-generator.ts --dry-run
 *   npx tsx scripts/competitor-brand-page-generator.ts --competitor=whoop.com
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const TARGET_COMPETITOR = process.argv.find((a) => a.startsWith('--competitor='))?.split('=')[1] ?? null;
const CURRENT_YEAR = new Date().getFullYear();

// ── Competitor definitions ────────────────────────────────────────────────────
type CompetitorDef = {
  domain: string;
  brand_name: string;
  category: string;
  use_cases: string[];
  price_range: string;
  subscription_model: boolean;
  estimated_dr: number;
  flagship_product: string;
  vs_targets: string[];  // brands/categories to compare against
};

const COMPETITORS: CompetitorDef[] = [
  {
    domain: 'whoop.com',
    brand_name: 'WHOOP',
    category: 'recovery wearable',
    use_cases: ['athlete recovery', 'HRV tracking', 'sleep monitoring', 'strain tracking'],
    price_range: '$30/month subscription',
    subscription_model: true,
    estimated_dr: 72,
    flagship_product: 'WHOOP 4.0',
    vs_targets: ['Oura Ring', 'Garmin', 'Apple Watch', 'Fitbit'],
  },
  {
    domain: 'ouraring.com',
    brand_name: 'Oura Ring',
    category: 'smart ring',
    use_cases: ['sleep tracking', 'readiness score', 'women\'s health', 'HRV tracking'],
    price_range: '$299–$399 + $5.99/month',
    subscription_model: true,
    estimated_dr: 68,
    flagship_product: 'Oura Ring Gen 3',
    vs_targets: ['WHOOP', 'Samsung Galaxy Ring', 'Ultrahuman Ring', 'RingConn'],
  },
  {
    domain: 'eightsleep.com',
    brand_name: 'Eight Sleep',
    category: 'smart mattress cover',
    use_cases: ['sleep temperature regulation', 'sleep tracking', 'recovery optimization'],
    price_range: '$1,995–$2,495 + $17/month',
    subscription_model: true,
    estimated_dr: 62,
    flagship_product: 'Eight Sleep Pod 3',
    vs_targets: ['ChiliPad', 'BedJet', 'Dock Pro'],
  },
  {
    domain: 'theragun.com',
    brand_name: 'Theragun',
    category: 'percussion massager',
    use_cases: ['muscle recovery', 'pre-workout activation', 'soreness relief', 'athletic recovery'],
    price_range: '$199–$599',
    subscription_model: false,
    estimated_dr: 65,
    flagship_product: 'Theragun Pro Gen 5',
    vs_targets: ['Hyperice Hypervolt', 'TimTam', 'Ekrin Athletics'],
  },
  {
    domain: 'hyperice.com',
    brand_name: 'Hyperice',
    category: 'recovery technology',
    use_cases: ['muscle recovery', 'vibration therapy', 'dynamic compression', 'heat therapy'],
    price_range: '$129–$899',
    subscription_model: false,
    estimated_dr: 60,
    flagship_product: 'Hypervolt Go 2',
    vs_targets: ['Theragun', 'TimTam', 'Sportneer'],
  },
  {
    domain: 'garmin.com',
    brand_name: 'Garmin',
    category: 'GPS sports watch',
    use_cases: ['triathlon training', 'running', 'HRV tracking', 'altitude training', 'recovery advisor'],
    price_range: '$299–$1,099',
    subscription_model: false,
    estimated_dr: 85,
    flagship_product: 'Garmin Fenix 7',
    vs_targets: ['Apple Watch Ultra', 'COROS', 'Suunto', 'Polar'],
  },
  {
    domain: 'polarusa.com',
    brand_name: 'Polar',
    category: 'heart rate monitor & sports watch',
    use_cases: ['heart rate monitoring', 'training load', 'recovery tracking', 'running'],
    price_range: '$99–$599',
    subscription_model: false,
    estimated_dr: 58,
    flagship_product: 'Polar H10',
    vs_targets: ['Garmin', 'WHOOP', 'Wahoo'],
  },
  {
    domain: 'withings.com',
    brand_name: 'Withings',
    category: 'health smartwatch',
    use_cases: ['ECG monitoring', 'sleep apnea detection', 'blood oxygen', 'activity tracking'],
    price_range: '$229–$499',
    subscription_model: false,
    estimated_dr: 64,
    flagship_product: 'ScanWatch 2',
    vs_targets: ['Apple Watch', 'Fitbit', 'Samsung Galaxy Watch'],
  },
  {
    domain: 'ultrahuman.com',
    brand_name: 'Ultrahuman',
    category: 'metabolic health ring',
    use_cases: ['glucose metabolism', 'sleep tracking', 'recovery', 'no subscription smart ring'],
    price_range: '$349',
    subscription_model: false,
    estimated_dr: 44,
    flagship_product: 'Ultrahuman Ring AIR',
    vs_targets: ['Oura Ring', 'WHOOP', 'RingConn'],
  },
  {
    domain: 'coros.com',
    brand_name: 'COROS',
    category: 'endurance sports watch',
    use_cases: ['ultra running', 'triathlon', 'long battery life', 'altitude training'],
    price_range: '$199–$699',
    subscription_model: false,
    estimated_dr: 52,
    flagship_product: 'COROS Pace 3',
    vs_targets: ['Garmin', 'Suunto', 'Apple Watch Ultra'],
  },
];

// ── Slug generation ───────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ── Page spec builder ─────────────────────────────────────────────────────────
type PageSpec = {
  slug: string;
  template: string;
  primary_keyword: string;
  title: string;
  meta_description: string;
  priority: number;
  page_type: string;
  competitor_domain: string;
  brief_context: Record<string, unknown>;
};

function buildAlternativesSpec(c: CompetitorDef): PageSpec {
  const keyword = `best ${c.brand_name.toLowerCase()} alternatives`;
  return {
    slug: slugify(`${c.brand_name}-alternatives`),
    template: 'alternatives',
    primary_keyword: keyword,
    title: `Best ${c.brand_name} Alternatives in ${CURRENT_YEAR} (Tested & Ranked)`,
    meta_description: `Looking for a ${c.brand_name} alternative? We tested the top ${c.category} options. Compare features, pricing, and who each is best for.`,
    priority: Math.round(c.estimated_dr * 1.2),
    page_type: 'alternatives',
    competitor_domain: c.domain,
    brief_context: {
      competitor_brand: c.brand_name,
      competitor_domain: c.domain,
      competitor_flagship: c.flagship_product,
      competitor_price: c.price_range,
      competitor_subscription: c.subscription_model,
      category: c.category,
      use_cases: c.use_cases,
      intent: 'buyer actively searching to move away from this brand',
      content_angle: 'rank alternatives by use case match, not just specs',
      required_sections: [
        `Why people leave ${c.brand_name}`,
        'Top alternatives compared',
        'Best alternative by use case',
        `${c.brand_name} vs alternatives: feature table`,
        'Which should you choose?',
      ],
    },
  };
}

function buildVsSpec(c: CompetitorDef, vsTarget: string): PageSpec {
  const keyword = `${c.brand_name.toLowerCase()} vs ${vsTarget.toLowerCase()}`;
  const slug = slugify(`${c.brand_name}-vs-${vsTarget}`);
  return {
    slug,
    template: 'comparisons',
    primary_keyword: keyword,
    title: `${c.brand_name} vs ${vsTarget}: Which Is Better in ${CURRENT_YEAR}?`,
    meta_description: `${c.brand_name} vs ${vsTarget} — head-to-head comparison of price, accuracy, battery life, and who each suits. Our verdict after testing both.`,
    priority: Math.round(c.estimated_dr * 1.1),
    page_type: 'vs_comparison',
    competitor_domain: c.domain,
    brief_context: {
      competitor_a: c.brand_name,
      competitor_a_domain: c.domain,
      competitor_b: vsTarget,
      category: c.category,
      intent: 'buyer weighing two specific options, close to purchase decision',
      content_angle: 'lead with the verdict, support with evidence — do not sit on the fence',
      required_sections: [
        'Quick verdict',
        'Head-to-head specs table',
        `${c.brand_name}: who it\'s best for`,
        `${vsTarget}: who it\'s best for`,
        'Price comparison',
        'Our testing experience',
        'Final recommendation',
      ],
    },
  };
}

function buildReviewVsSpec(c: CompetitorDef): PageSpec {
  const keyword = `${c.brand_name.toLowerCase()} review`;
  return {
    slug: slugify(`${c.brand_name}-review-${CURRENT_YEAR}`),
    template: 'reviews',
    primary_keyword: keyword,
    title: `${c.brand_name} Review ${CURRENT_YEAR}: Is It Worth It?`,
    meta_description: `Honest ${c.brand_name} review after 90 days of testing. Covers accuracy, comfort, app quality, ${c.subscription_model ? 'subscription cost,' : ''} and who it\'s actually for.`,
    priority: Math.round(c.estimated_dr * 1.15),
    page_type: 'review_vs',
    competitor_domain: c.domain,
    brief_context: {
      product: c.flagship_product,
      brand: c.brand_name,
      category: c.category,
      price: c.price_range,
      subscription: c.subscription_model,
      use_cases: c.use_cases,
      intent: 'buyer doing final research before purchasing — high commercial intent',
      content_angle: 'be opinionated, give a clear verdict, mention who should NOT buy it',
      required_sections: [
        'Our verdict (lead)',
        'Who should buy this',
        'Who should avoid this',
        'What we tested',
        'Accuracy & data quality',
        'App & software experience',
        'Battery life & durability',
        c.subscription_model ? 'Subscription cost analysis' : 'Value for money',
        'Best alternatives if this isn\'t right for you',
      ],
    },
  };
}

function buildUseCaseSpec(c: CompetitorDef, useCase: string): PageSpec {
  const keyword = `best ${c.category} for ${useCase}`;
  return {
    slug: slugify(`best-${c.category}-for-${useCase}`),
    template: 'guides',
    primary_keyword: keyword,
    title: `Best ${c.category.charAt(0).toUpperCase() + c.category.slice(1)} for ${useCase.charAt(0).toUpperCase() + useCase.slice(1)} in ${CURRENT_YEAR}`,
    meta_description: `The best ${c.category} for ${useCase} — we tested 8+ options and ranked them by accuracy, comfort, and ${useCase}-specific features.`,
    priority: Math.round(c.estimated_dr * 0.9),
    page_type: 'use_case',
    competitor_domain: c.domain,
    brief_context: {
      category: c.category,
      use_case: useCase,
      incumbent_brand: c.brand_name,
      intent: `buyer with specific use case in mind — outflank ${c.brand_name}'s owned search terms`,
      content_angle: 'lead with the use-case match, not the brand — "for [use case] you need X, Y, Z features"',
      required_sections: [
        `What to look for in a ${c.category} for ${useCase}`,
        'Top picks compared',
        'Best overall',
        'Best budget option',
        'Best premium option',
        'Feature comparison table',
        'Our methodology',
      ],
    },
  };
}

// ── Check if page/keyword already exists ──────────────────────────────────────
async function slugExists(slug: string): Promise<boolean> {
  const [{ data: page }, { data: queued }] = await Promise.all([
    supabase.from('pages').select('slug').eq('slug', slug).single(),
    supabase.from('keyword_queue').select('slug').eq('slug', slug).single(),
  ]);
  return !!(page || queued);
}

// ── Enqueue a page spec ───────────────────────────────────────────────────────
async function enqueuePageSpec(spec: PageSpec): Promise<void> {
  await supabase.from('keyword_queue').upsert({
    slug: spec.slug,
    keyword: spec.primary_keyword,
    template: spec.template,
    title: spec.title,
    meta_description: spec.meta_description,
    priority: spec.priority,
    status: 'pending',
    source: 'competitor_brand_generator',
    metadata: {
      page_type: spec.page_type,
      competitor_domain: spec.competitor_domain,
      brief_context: spec.brief_context,
      generated_at: new Date().toISOString(),
    },
  }, { onConflict: 'slug' });

  // Record in competitor_brand_pages tracking table
  await supabase.from('competitor_brand_pages').upsert({
    slug: spec.slug,
    competitor_domain: spec.competitor_domain,
    page_type: spec.page_type,
    primary_keyword: spec.primary_keyword,
    template: spec.template,
    priority: spec.priority,
    status: 'queued',
    generated_at: new Date().toISOString(),
  }, { onConflict: 'slug' });
}

async function processCompetitor(c: CompetitorDef): Promise<number> {
  const specs: PageSpec[] = [];

  // 1. Alternatives page (one per competitor)
  specs.push(buildAlternativesSpec(c));

  // 2. Review page (one per competitor)
  specs.push(buildReviewVsSpec(c));

  // 3. Vs pages (up to 3 per competitor — most search volume)
  for (const vsTarget of c.vs_targets.slice(0, 3)) {
    specs.push(buildVsSpec(c, vsTarget));
  }

  // 4. Use-case pages (up to 2 per competitor — long-tail, lower competition)
  for (const useCase of c.use_cases.slice(0, 2)) {
    specs.push(buildUseCaseSpec(c, useCase));
  }

  let enqueued = 0;
  for (const spec of specs) {
    const exists = await slugExists(spec.slug);
    if (exists) {
      console.log(`[brand-pages] ${spec.slug}: exists, skipping`);
      continue;
    }

    console.log(`[brand-pages] ${c.brand_name} → ${spec.page_type}: "${spec.primary_keyword}"`);

    if (!DRY_RUN) {
      await enqueuePageSpec(spec);
    }
    enqueued++;
  }

  return enqueued;
}

async function run(): Promise<void> {
  const targets = TARGET_COMPETITOR
    ? COMPETITORS.filter((c) => c.domain === TARGET_COMPETITOR || c.brand_name.toLowerCase() === TARGET_COMPETITOR.toLowerCase())
    : COMPETITORS;

  if (targets.length === 0) {
    console.log(`[brand-pages] No competitor found matching "${TARGET_COMPETITOR}"`);
    console.log(`[brand-pages] Available: ${COMPETITORS.map((c) => c.domain).join(', ')}`);
    return;
  }

  console.log(`[brand-pages] Processing ${targets.length} competitor(s) (dryRun=${DRY_RUN})`);

  let totalEnqueued = 0;
  for (const competitor of targets) {
    const count = await processCompetitor(competitor);
    totalEnqueued += count;
    console.log(`[brand-pages] ${competitor.brand_name}: ${count} page(s) queued`);
  }

  console.log(`[brand-pages] Done. ${totalEnqueued} total pages queued for generation.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
