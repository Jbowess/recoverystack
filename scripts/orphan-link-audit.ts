/**
 * Orphan Page Link Audit
 *
 * Finds published pages with fewer than MIN_INBOUND_LINKS inbound internal links.
 * For each orphan, force-links it from the most relevant pillar page and
 * up to 2 sibling pages based on keyword overlap.
 *
 * Pages with no inbound internal links receive zero PageRank flow from
 * your site's authority, so Google deprioritizes them even when crawlable.
 *
 * Run: npm run orphan:audit
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MIN_INBOUND_LINKS = 3;
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SMART_RING_ONLY = process.argv.includes('--smart-ring-only');

interface PageRow {
  id: string;
  slug: string;
  template: string;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  pillar_id: string | null;
  internal_links: Array<{ slug: string; anchor: string; template?: string }> | null;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function keywordOverlap(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  let overlap = 0;
  for (const t of tokA) {
    if (tokB.has(t)) overlap++;
  }
  return overlap / Math.max(tokA.size, tokB.size, 1);
}

function buildAnchorText(toKeyword: string | null): string {
  const target = toKeyword ?? 'recovery guide';
  return target
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 5)
    .join(' ');
}

function isSmartRingPage(page: PageRow): boolean {
  const haystack = [
    page.slug,
    page.primary_keyword ?? '',
    ...(page.secondary_keywords ?? []),
  ].join(' ').toLowerCase();

  return ['smart ring', 'ringconn', 'oura', 'ultrahuman', 'galaxy ring', 'volo ring', 'wearable ring', 'sleep ring', 'recovery ring']
    .some((term) => haystack.includes(term));
}

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id, slug, template, primary_keyword, secondary_keywords, pillar_id, internal_links')
    .eq('status', 'published');

  if (error) throw error;
  if (!pages || pages.length === 0) {
    console.log('[orphan-audit] No published pages found.');
    return;
  }

  const all = pages as PageRow[];
  const scopedPages = SMART_RING_ONLY ? all.filter(isSmartRingPage) : all;

  const inboundCount = new Map<string, number>(scopedPages.map((p) => [p.slug, 0]));

  for (const page of scopedPages) {
    for (const link of page.internal_links ?? []) {
      if (SMART_RING_ONLY && !inboundCount.has(link.slug)) continue;
      const count = inboundCount.get(link.slug) ?? 0;
      inboundCount.set(link.slug, count + 1);
    }
  }

  const orphans = scopedPages.filter((p) => (inboundCount.get(p.slug) ?? 0) < MIN_INBOUND_LINKS);

  console.log(`[orphan-audit] ${scopedPages.length} scoped published pages. Orphans (< ${MIN_INBOUND_LINKS} inbound links): ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('[orphan-audit] No orphan pages found.');
    return;
  }

  const pillars = scopedPages.filter((p) => p.template === 'pillars');
  const nonPillars = scopedPages.filter((p) => p.template !== 'pillars');

  let fixed = 0;
  let skipped = 0;

  for (const orphan of orphans) {
    const bestPillar = pillars
      .filter((p) => p.id !== orphan.id)
      .sort((a, b) => {
        const scoreA = a.id === orphan.pillar_id ? 999 : keywordOverlap(a.primary_keyword, orphan.primary_keyword);
        const scoreB = b.id === orphan.pillar_id ? 999 : keywordOverlap(b.primary_keyword, orphan.primary_keyword);
        return scoreB - scoreA;
      })[0];

    const bestSiblings = nonPillars
      .filter((p) => p.id !== orphan.id && p.slug !== orphan.slug)
      .map((p) => ({
        page: p,
        score: keywordOverlap(
          [p.primary_keyword, ...(p.secondary_keywords ?? [])].join(' '),
          [orphan.primary_keyword, ...(orphan.secondary_keywords ?? [])].join(' '),
        ),
      }))
      .filter(({ score }) => score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(({ page }) => page);

    const donors = [...(bestPillar ? [bestPillar] : []), ...bestSiblings];

    if (donors.length === 0) {
      console.log(`  ! ${orphan.slug} - no suitable donor pages found`);
      skipped++;
      continue;
    }

    const newLink = {
      slug: orphan.slug,
      anchor: buildAnchorText(orphan.primary_keyword),
      template: orphan.template,
    };

    console.log(`  -> Linking to "${orphan.slug}" from: ${donors.map((d) => d.slug).join(', ')}`);

    if (!isDryRun) {
      for (const donor of donors) {
        const existingLinks = donor.internal_links ?? [];
        if (existingLinks.some((l) => l.slug === orphan.slug)) continue;

        const updatedLinks = [...existingLinks, newLink];
        const { error: updateErr } = await supabase
          .from('pages')
          .update({ internal_links: updatedLinks })
          .eq('id', donor.id);

        if (updateErr) {
          console.warn(`  x Failed to update ${donor.slug}: ${updateErr.message}`);
        }
      }
    }

    fixed++;
  }

  console.log(
    `\n[orphan-audit] ${isDryRun ? '[DRY RUN] Would have fixed' : 'Fixed'} ${fixed} orphan page(s). Skipped ${skipped} (no suitable donors).`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
