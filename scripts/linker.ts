import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
import { buildClusterLinks, buildPillarDownLinks, isGenericAnchor } from '@/lib/linking';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const isVerifyMode = process.argv.includes('--verify') || process.env.VERIFY_LINKS === '1';

type PageRow = {
  id: string;
  slug: string;
  template: string;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  pillar_id: string | null;
  internal_links: Array<{ slug?: string; template?: string; anchor?: string }> | null;
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

  const all = ((pages ?? []) as PageRow[]).map((p) => ({
    pageId: p.id,
    slug: p.slug,
    template: p.template,
    primary_keyword: p.primary_keyword,
    secondary_keywords: p.secondary_keywords,
    pillar_id: p.pillar_id,
    internal_links: p.internal_links,
    published_at: p.published_at,
    updated_at: p.updated_at,
  }));

  let updates = 0;

  if (isVerifyMode) {
    for (const page of all) {
      const existing = page.internal_links ?? [];
      assertNoGenericAnchors(page.slug, existing);
      if (page.template !== 'pillars') {
        assertClusterConstraints(page.slug, existing as Array<{ template?: string }>);
      }
    }
  }

  for (const page of all.filter((p) => p.template !== 'pillars')) {
    const pillar = all.find((x) => x.pageId === page.pillar_id);
    if (!pillar) {
      throw new Error(`Missing pillar for cluster page '${page.slug}' (pillar_id=${page.pillar_id ?? 'null'}).`);
    }

    const links = buildClusterLinks(page, all, pillar.slug);
    const internal_links = [links.up, ...links.sideways];

    assertNoGenericAnchors(page.slug, internal_links);
    assertClusterConstraints(page.slug, internal_links);

    updates += 1;
    if (!isDryRun && !isVerifyMode) {
      await supabase.from('pages').update({ internal_links }).eq('id', page.pageId);
    }
  }

  for (const pillar of all.filter((p) => p.template === 'pillars')) {
    const children = all.filter((x) => x.pillar_id === pillar.pageId && x.template !== 'pillars');
    const down = buildPillarDownLinks(children);

    assertNoGenericAnchors(pillar.slug, down);

    updates += 1;
    if (!isDryRun && !isVerifyMode) {
      await supabase.from('pages').update({ internal_links: down }).eq('id', pillar.pageId);
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
