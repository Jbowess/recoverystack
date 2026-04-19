import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
import { buildClusterLinks, buildPillarDownLinks, isGenericAnchor } from '@/lib/linking';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const isVerifyMode = process.argv.includes('--verify') || process.env.VERIFY_LINKS === '1';

// Templates whose pages are "money pages" — highest-priority link targets
const MONEY_PAGE_TEMPLATES = ['pillars'] as const;

type PageRow = {
  id: string;
  slug: string;
  template: string;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  query_targets?: string[] | null;
  pillar_id: string | null;
  internal_links: Array<{ slug?: string; template?: string; anchor?: string; is_money_page?: boolean }> | null;
  published_at: string | null;
  updated_at: string | null;
};

function assertNoGenericAnchors(pageSlug: string, links: Array<{ anchor?: string }>) {
  const badAnchors = links
    .map((link) => (link.anchor ?? '').trim())
    .filter((anchor) => isGenericAnchor(anchor));

  if (badAnchors.length > 0) {
    throw new Error(`Generic anchors detected for '${pageSlug}': ${badAnchors.join(', ')}`);
  }
}

function assertClusterConstraints(pageSlug: string, links: Array<{ template?: string }>) {
  const upLinks = links.filter((link) => link.template === 'pillars');
  const siblingLinks = links.filter((link) => link.template !== 'pillars');

  if (upLinks.length !== 1) {
    throw new Error(`Cluster page '${pageSlug}' must contain exactly 1 pillar up-link; found ${upLinks.length}.`);
  }

  if (siblingLinks.length < 3 || siblingLinks.length > 5) {
    throw new Error(`Cluster page '${pageSlug}' must contain 3-5 sibling links; found ${siblingLinks.length}.`);
  }
}

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id,slug,template,primary_keyword,secondary_keywords,pillar_id,internal_links,status,published_at,updated_at')
    .eq('status', 'published');

  if (error) throw error;

  const { data: queryTargets } = await supabase
    .from('page_query_targets')
    .select('page_id,query')
    .order('priority', { ascending: false });

  const queryTargetMap = new Map<string, string[]>();
  for (const row of queryTargets ?? []) {
    const list = queryTargetMap.get(row.page_id) ?? [];
    list.push(String(row.query));
    queryTargetMap.set(row.page_id, list);
  }

  const all = ((pages ?? []) as PageRow[]).map((p) => ({
    pageId: p.id,
    slug: p.slug,
    template: p.template,
    primary_keyword: p.primary_keyword,
    secondary_keywords: p.secondary_keywords,
    query_targets: queryTargetMap.get(p.id) ?? [],
    pillar_id: p.pillar_id,
    internal_links: p.internal_links,
    published_at: p.published_at,
    updated_at: p.updated_at,
  }));

  // Build a set of all valid slugs for broken link detection
  const validSlugs = new Set(all.map((p) => p.slug));
  let updates = 0;
  let brokenLinksFound = 0;

  // Detect broken internal links in existing pages
  for (const page of all) {
    const existing = page.internal_links ?? [];
    for (const link of existing) {
      if (link.slug && !validSlugs.has(link.slug)) {
        brokenLinksFound += 1;
        console.warn(`[broken-link] Page '${page.slug}' links to non-existent slug '${link.slug}'`);
      }
    }
  }

  if (brokenLinksFound > 0) {
    console.warn(`[linker] Found ${brokenLinksFound} broken internal link(s). They will be rebuilt.`);
  }

  if (isVerifyMode) {
    for (const page of all) {
      const existing = page.internal_links ?? [];
      assertNoGenericAnchors(page.slug, existing);
      // News pages use a flat link model (→ evergreen) — not the cluster pillar/sibling model
      if (page.template !== 'pillars' && page.template !== 'news') {
        assertClusterConstraints(page.slug, existing as Array<{ template?: string }>);
      }
    }
  }

  // News pages: link to the most relevant evergreen guide/protocol/metric on the same topic.
  // They do not participate in the cluster pillar/sibling model.
  const evergreenTemplates = ['guides', 'alternatives', 'protocols', 'metrics', 'costs', 'compatibility', 'pillars'];
  for (const page of all.filter((p) => p.template === 'news')) {
    // Find evergreen pages whose keywords overlap with this news page's keyword
    const newsKeywords = [
      page.primary_keyword ?? '',
      ...(page.secondary_keywords ?? []),
    ].map((k) => k.toLowerCase()).filter(Boolean);

    const candidates = all
      .filter((p) => evergreenTemplates.includes(p.template))
      .map((p) => {
        const pageKeywords = [
          p.primary_keyword ?? '',
          ...(p.secondary_keywords ?? []),
          ...(p.query_targets ?? []),
        ].map((k) => k.toLowerCase());
        const overlap = newsKeywords.filter((k) => pageKeywords.some((pk) => pk.includes(k) || k.includes(pk))).length;
        const isMoneyPage = (MONEY_PAGE_TEMPLATES as readonly string[]).includes(p.template);
        return { ...p, overlap, isMoneyPage };
      })
      .filter((p) => p.overlap > 0)
      // Money pages sort first so the first link always points to a pillar when one matches
      .sort((a, b) => {
        if (a.isMoneyPage !== b.isMoneyPage) return a.isMoneyPage ? -1 : 1;
        return b.overlap - a.overlap;
      })
      .slice(0, 3);

    if (candidates.length === 0) {
      console.log(`[linker] News page '${page.slug}' — no evergreen candidates found, skipping`);
      continue;
    }

    const internal_links = candidates.map((c) => ({
      slug: c.slug,
      template: c.template,
      anchor: c.primary_keyword ?? c.slug,
      ...(c.isMoneyPage ? { is_money_page: true } : {}),
    })).filter((l) => validSlugs.has(l.slug));

    assertNoGenericAnchors(page.slug, internal_links);

    updates += 1;
    if (!isDryRun && !isVerifyMode) {
      await supabase.from('pages').update({ internal_links, needs_revalidation: true }).eq('id', page.pageId);
    }
  }

  for (const page of all.filter((p) => p.template !== 'pillars' && p.template !== 'news')) {
    const pillar = all.find((x) => x.pageId === page.pillar_id);
    if (!pillar) {
      // Gracefully handle orphaned cluster pages: try to find a pillar in the same cluster
      const fallbackPillar = all.find((x) => x.template === 'pillars');
      if (!fallbackPillar) {
        console.warn(`[linker] Skipping orphaned cluster page '${page.slug}' (pillar_id=${page.pillar_id ?? 'null'}) — no pillar pages exist.`);
        continue;
      }
      console.warn(`[linker] Page '${page.slug}' has missing pillar (${page.pillar_id ?? 'null'}). Reassigning to fallback pillar '${fallbackPillar.slug}'.`);

      if (!isDryRun && !isVerifyMode) {
        await supabase.from('pages').update({ pillar_id: fallbackPillar.pageId, needs_revalidation: true }).eq('id', page.pageId);
      }

      const links = buildClusterLinks(page, all, fallbackPillar.slug);
      const internal_links = [links.up, ...links.sideways];

      // Filter out any broken links
      const validLinks = internal_links.filter((l) => validSlugs.has(l.slug));
      assertNoGenericAnchors(page.slug, validLinks);

      updates += 1;
      if (!isDryRun && !isVerifyMode) {
        await supabase.from('pages').update({ internal_links: validLinks, needs_revalidation: true }).eq('id', page.pageId);
      }
      continue;
    }

    const links = buildClusterLinks(page, all, pillar.slug);
    const internal_links = [links.up, ...links.sideways].filter((l) => validSlugs.has(l.slug));

    assertNoGenericAnchors(page.slug, internal_links);
    assertClusterConstraints(page.slug, internal_links);

    updates += 1;
    if (!isDryRun && !isVerifyMode) {
      await supabase.from('pages').update({ internal_links, needs_revalidation: true }).eq('id', page.pageId);
    }
  }

  for (const pillar of all.filter((p) => p.template === 'pillars')) {
    const children = all.filter((x) => x.pillar_id === pillar.pageId && x.template !== 'pillars');
    const down = buildPillarDownLinks(children).filter((l) => validSlugs.has(l.slug));

    assertNoGenericAnchors(pillar.slug, down);

    updates += 1;
    if (!isDryRun && !isVerifyMode) {
      await supabase.from('pages').update({ internal_links: down, needs_revalidation: true }).eq('id', pillar.pageId);
    }
  }

  if (isVerifyMode) {
    console.log(`Internal links verification passed. Checked pages=${all.length}. Planned updates=${updates}`);
    return;
  }

  console.log(isDryRun ? `Internal links dry-run complete. Planned updates=${updates}` : 'Internal links recomputed.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
