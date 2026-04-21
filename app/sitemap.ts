import { MetadataRoute } from 'next';
import { latestSnapshotMap } from '@/lib/ai-reach';
import { BRAND_ENTITY_SEEDS } from '@/lib/brand-entities';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getAllPublishedSlugs } from '@/lib/supabase';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

const TEMPLATE_PRIORITIES: Record<string, number> = {
  pillars: 0.9,
  news: 0.9,     // news pages get high priority + daily change frequency
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

export default async function sitemap({
  id,
}: {
  id: string | string[] | number;
}): Promise<MetadataRoute.Sitemap> {
  const sitemapId = Array.isArray(id) ? String(id[0] ?? '') : String(id);

  // Static pages sitemap
  if (sitemapId === 'static') {
    const today = new Date().toISOString().split('T')[0];
    const staticEntries: MetadataRoute.Sitemap = [
      { url: `${SITE_URL}/`, lastModified: today, changeFrequency: 'daily', priority: 1 },
      { url: `${SITE_URL}/evidence`, lastModified: today, changeFrequency: 'weekly', priority: 0.85 },
      { url: `${SITE_URL}/research`, lastModified: today, changeFrequency: 'weekly', priority: 0.85 },
      { url: `${SITE_URL}/tools`, lastModified: today, changeFrequency: 'weekly', priority: 0.8 },
      { url: `${SITE_URL}/tools/smart-ring-fit`, lastModified: today, changeFrequency: 'weekly', priority: 0.75 },
      { url: `${SITE_URL}/tools/subscription-cost-calculator`, lastModified: today, changeFrequency: 'weekly', priority: 0.75 },
      { url: `${SITE_URL}/tools/platform-compatibility`, lastModified: today, changeFrequency: 'weekly', priority: 0.75 },
      { url: `${SITE_URL}/entities`, lastModified: today, changeFrequency: 'weekly', priority: 0.75 },
      ...BRAND_ENTITY_SEEDS.map((seed) => ({
        url: `${SITE_URL}/entities/${seed.slug}`,
        lastModified: today,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ];

    try {
      const { data, error } = await supabaseAdmin
        .from('comparison_dataset_snapshots')
        .select('dataset_key,snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(40);

      if (!error) {
        const latestDatasets = [...latestSnapshotMap((data ?? []) as Array<{
          dataset_key: string;
          snapshot_date: string;
        }>).values()];
        staticEntries.push(
          ...latestDatasets.map((dataset) => ({
            url: `${SITE_URL}/research/${dataset.dataset_key}`,
            lastModified: dataset.snapshot_date,
            changeFrequency: 'weekly' as const,
            priority: 0.72,
          })),
        );
      }
    } catch {
      // Keep sitemap generation resilient when research tables are unavailable.
    }

    return staticEntries;
  }

  // Parse template name and optional chunk index from id (e.g. "guides" or "guides-2")
  const dashIdx = sitemapId.lastIndexOf('-');
  let template: string;
  let chunkIndex = 0;
  if (dashIdx > 0 && !Number.isNaN(Number(sitemapId.slice(dashIdx + 1)))) {
    template = sitemapId.slice(0, dashIdx);
    chunkIndex = Number(sitemapId.slice(dashIdx + 1));
  } else {
    template = sitemapId;
  }

  const allPages = await getAllPublishedSlugs();
  const templatePages = allPages
    .filter((p) => p.template === template && p.slug)
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(chunkIndex * MAX_PER_SITEMAP, (chunkIndex + 1) * MAX_PER_SITEMAP);

  return templatePages.map((p) => {
    const pageUrl = `${SITE_URL}/${p.template}/${p.slug}`;
    const lastMod = new Date(p.updated_at);
    const isNews = p.template === 'news';
    return {
      url: pageUrl,
      lastModified: Number.isNaN(lastMod.getTime()) ? undefined : lastMod.toISOString(),
      changeFrequency: (isNews ? 'daily' : 'weekly') as 'daily' | 'weekly',
      priority: TEMPLATE_PRIORITIES[p.template] ?? 0.6,
      images: [`${pageUrl}/opengraph-image`],
    };
  });
}
