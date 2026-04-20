import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { CORE_REACH_THESES } from '@/lib/reach-theses';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

const FRAMEWORKS = [
  {
    slug: 'twelve-month-cost-reality',
    title: '12-Month Cost Reality',
    description: 'Frame wearable decisions around year-one total cost, not sticker price.',
    use_cases: ['cost pages', 'subscription comparisons', 'buyer briefs'],
    example_lines: ['The cheaper device upfront is not always the cheaper device in month 12.'],
  },
  {
    slug: 'sleep-signal-quality',
    title: 'Sleep Signal Quality',
    description: 'Judge sleep products by overnight comfort, consistency, and usefulness of the signal.',
    use_cases: ['sleep pages', 'review pages', 'short-form video'],
    example_lines: ['A ring that is uncomfortable overnight is not a serious sleep product.'],
  },
  {
    slug: 'recovery-adherence-score',
    title: 'Recovery Adherence Score',
    description: 'Measure whether the device is likely to be worn consistently enough to matter.',
    use_cases: ['reviews', 'alternatives', 'creator briefs'],
    example_lines: ['The best recovery device is the one the buyer will actually keep wearing.'],
  },
  {
    slug: 'subscription-friction-index',
    title: 'Subscription Friction Index',
    description: 'Assess how recurring fees and gated features affect long-term buyer fit.',
    use_cases: ['pricing', 'comparison', 'newsletter'],
    example_lines: ['Subscription burden should shape the shortlist before the feature matrix does.'],
  },
];

const THESIS_FRAMEWORKS = CORE_REACH_THESES.map((thesis, index) => ({
  slug: `reach-thesis-${thesis.slug}`,
  title: thesis.title,
  description: thesis.thesis,
  use_cases: ['rapid response', 'social distribution', 'newsletter', 'landing loops'],
  example_lines: thesis.supportingFrames,
  metadata: {
    seeded_from: 'core_reach_theses',
    priority: 100 - index,
    thesis_slug: thesis.slug,
  },
}));

async function run() {
  let written = 0;
  for (const framework of [...FRAMEWORKS, ...THESIS_FRAMEWORKS]) {
    written += 1;
    if (DRY_RUN) {
      console.log(`[brand-framework-seeder] ${framework.slug}`);
      continue;
    }

    const { error } = await supabase.from('brand_frameworks').upsert({
      ...framework,
      status: 'active',
      metadata: { seeded: true, ...(framework as any).metadata },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'slug' });

    if (error?.message?.includes('brand_frameworks')) {
      console.log('[brand-framework-seeder] brand_frameworks missing - skipping persistence.');
      break;
    }
    if (error) throw error;
  }

  console.log(`[brand-framework-seeder] written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
