/**
 * Orphan Page Link Audit
 *
 * Finds published pages with fewer than MIN_INBOUND_LINKS inbound internal links.
 * For each orphan, force-links it from the most relevant pillar page and
 * up to 2 sibling pages based on keyword overlap.
 *
 * Pages with no inbound internal links receive zero PageRank flow from
 * your site's authority — Google deprioritises them even when crawlable.
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
  for (const t of tokA) { if (tokB.has(t)) overlap++; }
  return overlap / Math.max(tokA.size, tokB.size, 1);
}

function buildAnchorText(fromKeyword: string | null, toKeyword: string | null): string {
  const target = toKeyword ?? 'recovery guide';
  // Use first 4-5 meaningful words of target keyword
  const words = target.split(' ').filter((w) => w.length > 2).slice(0, 5);
  return words.join(' ');
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

  // Build inbound link count map: slug → count of pages that link TO it
  const inboundCount = new Map<string, number>(all.map((p) => [p.slug, 0]));

  for (const page of all) {
    for (const link of page.internal_links ?? []) {
      const count = inboundCount.get(link.slug) ?? 0;
      inboundCount.set(link.slug, count + 1);
    }
  }

  const orphans = all.filter((p) => (inboundCount.get(p.slug) ?? 0) < MIN_INBOUND_LINKS);

  console.log(`[orphan-audit] ${all.length} published pages. Orphans (< ${MIN_INBOUND_LINKS} inbound links): ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('[orphan-audit] No orphan pages found.');
    return;
  }

  // Identify pillar pages as the primary donors
  const pillars = all.filter((p) => p.template === 'pillars');
  const nonPillars = all.filter((p) => p.template !== 'pillars');

  let fixed = 0;
  let skipped = 0;

  for (const orphan of orphans) {
    // Find best pillar to link from (same pillar_id, or highest keyword overlap)
    const bestPillar = pillars
      .filter((p) => p.id !== orphan.id)
      .sort((a, b) => {
        const scoreA = a.id === orphan.pillar_id ? 999 : keywordOverlap(a.primary_keyword, orphan.primary_keyword);
        const scoreB = b.id === orphan.pillar_id ? 999 : keywordOverlap(b.primary_keyword, orphan.primary_keyword);
        return scoreB - scoreA;
      })[0];

    // Find 2 best non-pillar donor pages by keyword overlap
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
      console.log(`  ⚠ ${orphan.slug} — no suitable donor pages found`);
      skipped++;
      continue;
    }

    const newLink = {
      slug: orphan.slug,
      anchor: buildAnchorText(donors[0]?.primary_keyword ?? null, orphan.primary_keyword),
      template: orphan.template,
    };

    console.log(`  → Linking to "${orphan.slug}" from: ${donors.map((d) => d.slug).join(', ')}`);

    if (!isDryRun) {
      // Update each donor page to include a link to the orphan
      for (const donor of donors) {
        const existingLinks = donor.internal_links ?? [];
        // Don't add duplicate link
        if (existingLinks.some((l) => l.slug === orphan.slug)) continue;

        const updatedLinks = [...existingLinks, newLink];

        const { error: updateErr } = await supabase
          .from('pages')
          .update({ internal_links: updatedLinks })
          .eq('id', donor.id);

        if (updateErr) {
          console.warn(`  ✗ Failed to update ${donor.slug}: ${updateErr.message}`);
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
