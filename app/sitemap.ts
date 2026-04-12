import { MetadataRoute } from 'next';
import { getAllPublishedSlugs } from '@/lib/supabase';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

const TEMPLATE_PRIORITIES: Record<string, number> = {
  pillars: 0.9,
  guides: 0.8,
  alternatives: 0.7,
  protocols: 0.7,
  metrics: 0.6,
  compatibility: 0.6,
  costs: 0.5,
  trends: 0.5,
};

const TEMPLATES = Object.keys(TEMPLATE_PRIORITIES);

// Max URLs per sitemap file (Google limit is 50,000; we stay well under)
const MAX_PER_SITEMAP = 5000;

export async function generateSitemaps() {
  const pages = await getAllPublishedSlugs();

  // Group by template
  const groups: Record<string, number> = {};
  for (const p of pages) {
    if (!p.template || !p.slug) continue;
    groups[p.template] = (groups[p.template] ?? 0) + 1;
  }

  const ids: Array<{ id: string }> = [];

  // Static sitemap for home/marketing pages
  ids.push({ id: 'static' });

  // One sitemap per template (split if > MAX_PER_SITEMAP)
  for (const template of TEMPLATES) {
    const count = groups[template] ?? 0;
    if (count === 0) continue;
    const chunks = Math.ceil(count / MAX_PER_SITEMAP);
    for (let i = 0; i < chunks; i++) {
      ids.push({ id: chunks > 1 ? `${template}-${i}` : template });
    }
  }

  return ids;
}

export default async function sitemap({ id }: { id: string }): Promise<MetadataRoute.Sitemap> {
  // Static pages sitemap
  if (id === 'static') {
    return [
      {
        url: `${SITE_URL}/`,
        lastModified: new Date().toISOString().split('T')[0],
        changeFrequency: 'daily' as const,
        priority: 1,
      },
    ];
  }

  // Parse template name and optional chunk index from id (e.g. "guides" or "guides-2")
  const dashIdx = id.lastIndexOf('-');
  let template: string;
  let chunkIndex = 0;
  if (dashIdx > 0 && !Number.isNaN(Number(id.slice(dashIdx + 1)))) {
    template = id.slice(0, dashIdx);
    chunkIndex = Number(id.slice(dashIdx + 1));
  } else {
    template = id;
  }

  const allPages = await getAllPublishedSlugs();
  const templatePages = allPages
    .filter((p) => p.template === template && p.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(chunkIndex * MAX_PER_SITEMAP, (chunkIndex + 1) * MAX_PER_SITEMAP);

  return templatePages.map((p) => {
    const pageUrl = `${SITE_URL}/${p.template}/${p.slug}`;
    const lastMod = new Date(p.updated_at);
    return {
      url: pageUrl,
      lastModified: Number.isNaN(lastMod.getTime()) ? undefined : lastMod.toISOString(),
      changeFrequency: 'weekly' as const,
      priority: TEMPLATE_PRIORITIES[p.template] ?? 0.6,
      images: [`${pageUrl}/opengraph-image`],
    };
  });
}
