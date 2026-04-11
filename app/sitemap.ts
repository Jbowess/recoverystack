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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await getAllPublishedSlugs();

  const contentPages = pages
    .map((p) => ({
      url: `${SITE_URL}/${p.template}/${p.slug}`,
      lastModified: p.updated_at,
      changeFrequency: 'weekly' as const,
      priority: TEMPLATE_PRIORITIES[p.template] ?? 0.6,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));

  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'daily',
      priority: 1,
    },
    ...contentPages,
  ];
}
