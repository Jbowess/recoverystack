/**
 * Competitor Keywords Seed
 *
 * Seeds keyword_queue with high-intent competitor comparison and
 * alternatives keywords — piggybacks on existing brand search volume
 * rather than generating demand from scratch.
 *
 * Patterns:
 *   "{competitor} vs volo ring"     — comparison, high conversion intent
 *   "volo ring vs {competitor}"     — our brand first
 *   "{competitor} alternatives"     — alternative-seeker traffic
 *   "best {competitor} alternative" — bottom-funnel buying intent
 *
 * Usage:
 *   npx tsx scripts/competitor-keywords-seed.ts
 *   npx tsx scripts/competitor-keywords-seed.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const OUR_BRAND = 'volo ring';

type Competitor = {
  id: string;
  name: string;
  variants: string[];
  priority_base: number;
};

const COMPETITORS: Competitor[] = [
  { id: 'oura',       name: 'oura ring',          variants: ['oura ring 4', 'oura ring 3'],  priority_base: 98 },
  { id: 'whoop',      name: 'whoop',               variants: ['whoop 4.0', 'whoop 5.0'],      priority_base: 95 },
  { id: 'ultrahuman', name: 'ultrahuman ring',      variants: ['ultrahuman ring air'],         priority_base: 90 },
  { id: 'galaxy',     name: 'samsung galaxy ring',  variants: ['galaxy ring'],                 priority_base: 88 },
  { id: 'ringconn',   name: 'ringconn',             variants: ['ringconn smart ring'],         priority_base: 82 },
  { id: 'circular',   name: 'circular ring',        variants: [],                              priority_base: 72 },
  { id: 'evie',       name: 'evie ring',            variants: [],                              priority_base: 68 },
  { id: 'amazfit',    name: 'amazfit helio ring',   variants: [],                              priority_base: 65 },
];

type Pattern = 'vs_them' | 'vs_us' | 'alternatives' | 'best_alternative';

type KeywordEntry = {
  keyword: string;
  cluster_name: string;
  template_id: 'alternatives';
  priority: number;
  competitor_id: string;
  pattern: Pattern;
};

function buildEntries(): KeywordEntry[] {
  const entries: KeywordEntry[] = [];

  for (const comp of COMPETITORS) {
    const primaryAndVariants = [comp.name, ...comp.variants];

    for (const name of primaryAndVariants) {
      entries.push({
        keyword: `${name} vs ${OUR_BRAND}`,
        cluster_name: `${comp.id}-vs-volo`,
        template_id: 'alternatives',
        priority: Math.min(99, comp.priority_base),
        competitor_id: comp.id,
        pattern: 'vs_them',
      });

      entries.push({
        keyword: `${OUR_BRAND} vs ${name}`,
        cluster_name: `volo-vs-${comp.id}`,
        template_id: 'alternatives',
        priority: Math.min(99, comp.priority_base - 2),
        competitor_id: comp.id,
        pattern: 'vs_us',
      });
    }

    // alternatives and best_alternative only for primary name
    entries.push({
      keyword: `${comp.name} alternatives`,
      cluster_name: `${comp.id}-alternatives`,
      template_id: 'alternatives',
      priority: Math.min(99, comp.priority_base + 2),
      competitor_id: comp.id,
      pattern: 'alternatives',
    });

    entries.push({
      keyword: `best ${comp.name} alternative`,
      cluster_name: `${comp.id}-alternatives`,
      template_id: 'alternatives',
      priority: Math.min(99, comp.priority_base + 3),
      competitor_id: comp.id,
      pattern: 'best_alternative',
    });
  }

  return entries;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 90);
}

async function getExistingPrimaryKeywords(keywords: string[]): Promise<Set<string>> {
  const [{ data: pages }, { data: queued }] = await Promise.all([
    supabase.from('pages').select('primary_keyword').in('primary_keyword', keywords),
    supabase.from('keyword_queue').select('primary_keyword').in('primary_keyword', keywords),
  ]);
  const existing = new Set<string>();
  for (const row of [...(pages ?? []), ...(queued ?? [])]) {
    if (row.primary_keyword) existing.add(row.primary_keyword);
  }
  return existing;
}

async function run(): Promise<void> {
  const entries = buildEntries();
  const allKeywords = entries.map((e) => e.keyword);
  const existing = await getExistingPrimaryKeywords(allKeywords);

  let queued = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (existing.has(entry.keyword)) {
      skipped++;
      continue;
    }

    console.log(`[competitor-seed] ${entry.pattern}: "${entry.keyword}" (priority=${entry.priority})`);

    if (!DRY_RUN) {
      await supabase.from('keyword_queue').upsert({
        cluster_name: entry.cluster_name,
        primary_keyword: entry.keyword,
        template_id: entry.template_id,
        source: 'competitor_seed',
        status: 'new',
        priority: entry.priority,
        score: entry.priority / 100,
        metadata: {
          competitor_id: entry.competitor_id,
          pattern: entry.pattern,
          market_focus: 'smart_ring',
          seeded_at: new Date().toISOString(),
          desired_template_id: entry.template_id,
        },
      }, { onConflict: 'cluster_name,primary_keyword' });
    }

    queued++;
  }

  console.log(`[competitor-seed] Done. ${queued} queued, ${skipped} already exist (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
