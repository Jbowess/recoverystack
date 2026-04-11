import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type SmokePageSeed = {
  slug: string;
  template: 'pillars' | 'guides' | 'alternatives' | 'metrics' | 'costs';
  title: string;
  meta_description: string;
  h1: string;
  intro: string;
  primary_keyword: string;
  secondary_keywords: string[];
};

const PAGE_SEEDS: SmokePageSeed[] = [
  {
    slug: 'best-battery-backup-systems',
    template: 'pillars',
    title: 'Battery Backup Systems: Complete RecoveryStack Test Hub',
    meta_description: 'Pillar page for smoke-testing RecoveryStack internal links and deploy flows.',
    h1: 'Battery Backup Systems Test Hub',
    intro: 'Synthetic pillar page used for end-to-end validation in non-production smoke runs.',
    primary_keyword: 'battery backup systems',
    secondary_keywords: ['power outage planning', 'home energy backup'],
  },
  {
    slug: 'how-to-choose-a-home-battery-for-backup',
    template: 'guides',
    title: 'How to Choose a Home Battery for Backup Power',
    meta_description: 'Guide page used for smoke test seeding and linker validation.',
    h1: 'How to Choose a Home Battery',
    intro: 'This guide is seeded automatically for smoke-test validation.',
    primary_keyword: 'choose home battery',
    secondary_keywords: ['battery chemistry', 'backup sizing'],
  },
  {
    slug: 'tesla-powerwall-vs-enphase-iq-battery',
    template: 'alternatives',
    title: 'Tesla Powerwall vs Enphase IQ Battery',
    meta_description: 'Comparison page inserted by smoke seeding for E2E checks.',
    h1: 'Tesla Powerwall vs Enphase IQ Battery',
    intro: 'Synthetic comparison content to validate template routing and link graphing.',
    primary_keyword: 'tesla powerwall vs enphase',
    secondary_keywords: ['battery alternatives', 'backup comparison'],
  },
  {
    slug: 'home-battery-payback-metrics-australia',
    template: 'metrics',
    title: 'Home Battery Payback Metrics in Australia',
    meta_description: 'Metrics page used by smoke tests to validate published content flow.',
    h1: 'Home Battery Payback Metrics',
    intro: 'Generated smoke-test metric content for checking deploy and revalidation paths.',
    primary_keyword: 'battery payback metrics',
    secondary_keywords: ['roi battery storage', 'energy bill savings'],
  },
  {
    slug: 'home-battery-installation-cost-breakdown',
    template: 'costs',
    title: 'Home Battery Installation Cost Breakdown',
    meta_description: 'Costs page seeded for end-to-end smoke testing.',
    h1: 'Home Battery Installation Costs',
    intro: 'Seeded example used to verify cost template rendering and link updates.',
    primary_keyword: 'home battery installation cost',
    secondary_keywords: ['battery install pricing', 'rebate assumptions'],
  },
];

const TREND_SEEDS = [
  { term: 'virtual power plant australia', source: 'smoke-seed', score: 82, competition: 'medium', status: 'new' },
  { term: 'home battery rebates qld', source: 'smoke-seed', score: 76, competition: 'high', status: 'new' },
  { term: 'blackout preparedness checklist', source: 'smoke-seed', score: 69, competition: 'medium', status: 'new' },
  { term: 'solar battery lifespan calculator', source: 'smoke-seed', score: 74, competition: 'low', status: 'new' },
  { term: 'off-grid inverter compatibility', source: 'smoke-seed', score: 65, competition: 'medium', status: 'new' },
];

const PRODUCT_SEEDS = [
  {
    name: 'Powerwall 3',
    brand: 'Tesla',
    price_aud: 13800,
    battery_days: 2.4,
    subscription_required: false,
    unique_features: ['Integrated inverter', 'Storm Watch mode'],
    affiliate_url: 'https://example.com/powerwall-3',
  },
  {
    name: 'IQ Battery 5P',
    brand: 'Enphase',
    price_aud: 11900,
    battery_days: 1.8,
    subscription_required: false,
    unique_features: ['Modular architecture', 'Low-noise operation'],
    affiliate_url: 'https://example.com/iq-battery-5p',
  },
  {
    name: 'SonnenBatterie 10',
    brand: 'Sonnen',
    price_aud: 14500,
    battery_days: 2.1,
    subscription_required: true,
    unique_features: ['VPP-ready software', 'Smart load control'],
    affiliate_url: 'https://example.com/sonnen-10',
  },
  {
    name: 'BYD Battery-Box Premium HVM',
    brand: 'BYD',
    price_aud: 10800,
    battery_days: 1.9,
    subscription_required: false,
    unique_features: ['Stackable capacity', 'High round-trip efficiency'],
    affiliate_url: 'https://example.com/byd-hvm',
  },
  {
    name: 'AlphaESS Smile 5',
    brand: 'AlphaESS',
    price_aud: 10200,
    battery_days: 1.6,
    subscription_required: false,
    unique_features: ['App monitoring', 'Hybrid inverter support'],
    affiliate_url: 'https://example.com/alphaess-smile-5',
  },
];

function runScript(script: string, args: string[] = []) {
  const cmd = ['tsx', script, ...args];
  console.log(`Running: npx ${cmd.join(' ')}`);

  const result = spawnSync('npx', cmd, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`Step failed: npx ${cmd.join(' ')} (exit=${result.status ?? 'unknown'})`);
  }
}

async function seedPages() {
  const pillar = PAGE_SEEDS[0];

  const { data: pillarRow, error: pillarError } = await supabase
    .from('pages')
    .upsert(
      {
        slug: pillar.slug,
        template: pillar.template,
        title: pillar.title,
        meta_description: pillar.meta_description,
        h1: pillar.h1,
        intro: pillar.intro,
        body_json: { sections: [{ id: 'overview', heading: 'Overview', kind: 'paragraphs', content: ['Smoke test seed pillar content.'] }] },
        primary_keyword: pillar.primary_keyword,
        secondary_keywords: pillar.secondary_keywords,
        status: 'published',
        published_at: new Date().toISOString(),
      },
      { onConflict: 'slug' },
    )
    .select('id')
    .single();

  if (pillarError || !pillarRow) {
    throw new Error(`Unable to upsert pillar page: ${pillarError?.message ?? 'missing row'}`);
  }

  const clusterRows = PAGE_SEEDS.slice(1).map((page) => ({
    slug: page.slug,
    template: page.template,
    title: page.title,
    meta_description: page.meta_description,
    h1: page.h1,
    intro: page.intro,
    body_json: { sections: [{ id: 'summary', heading: 'Summary', kind: 'paragraphs', content: ['Smoke test seeded section.'] }] },
    pillar_id: pillarRow.id,
    primary_keyword: page.primary_keyword,
    secondary_keywords: page.secondary_keywords,
    status: 'published',
    published_at: new Date().toISOString(),
  }));

  const { error: clusterError } = await supabase.from('pages').upsert(clusterRows, { onConflict: 'slug' });
  if (clusterError) throw new Error(`Unable to upsert cluster pages: ${clusterError.message}`);

  console.log(`Seeded pages (idempotent upsert): ${PAGE_SEEDS.length}`);
}

async function seedProducts() {
  const now = new Date().toISOString();
  const rows = PRODUCT_SEEDS.map((product) => ({ ...product, last_scraped: now }));
  const { error } = await supabase.from('products').upsert(rows, { onConflict: 'name' });
  if (error) throw new Error(`Unable to seed products: ${error.message}`);

  console.log(`Seeded products (idempotent upsert): ${PRODUCT_SEEDS.length}`);
}

async function seedTrends() {
  const { error } = await supabase.from('trends').upsert(TREND_SEEDS, { onConflict: 'term' });
  if (error) throw new Error(`Unable to seed trends: ${error.message}`);

  console.log(`Seeded trends (idempotent upsert): ${TREND_SEEDS.length}`);
}

async function main() {
  console.log('Starting smoke test seed run...');

  await seedPages();
  await seedProducts();
  await seedTrends();

  runScript('scripts/linker.ts', ['--dry-run']);
  runScript('scripts/deploy.ts', ['--dry-run']);

  console.log('Smoke test seed run complete.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
