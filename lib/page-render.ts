import type { Metadata } from 'next';
import type { InternalLink, PageRecord } from '@/lib/types';
import { articleSchema, breadcrumbSchema, faqSchema, productSchema } from '@/lib/schema-org';

const SITE = process.env.SITE_URL ?? 'https://recoverystack.io';
const SITE_NAME = 'RecoveryStack.io';

function titleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function splitInternalLinks(page: PageRecord): { pillarLink: InternalLink | null; siblingLinks: InternalLink[] } {
  const links = page.internal_links ?? [];
  const pillar = links.find((l) => l.template === 'pillars') ?? null;
  const siblings = links.filter((l) => l.template !== 'pillars').slice(0, 5);
  return { pillarLink: pillar, siblingLinks: siblings };
}

export function buildPageMetadata(page: PageRecord, path: string): Metadata {
  const url = `${SITE}${path}`;
  const ogImage = `${url}/opengraph-image`;

  return {
    title: page.title,
    description: page.meta_description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: page.title,
      description: page.meta_description,
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1200, height: 630, alt: page.title }],
      ...(page.published_at ? { publishedTime: page.published_at } : {}),
      modifiedTime: page.updated_at,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.title,
      description: page.meta_description,
      images: [ogImage],
    },
  };
}

export function buildSchemaBundle(page: PageRecord, path: string) {
  const url = `${SITE}${path}`;
  const out: unknown[] = [];

  out.push(articleSchema(page, url));
  out.push(
    breadcrumbSchema([
      { name: 'Home', url: SITE },
      { name: titleCase(page.template), url: `${SITE}/${page.template}` },
      { name: page.title, url },
    ]),
  );

  const faqs = page.body_json?.faqs ?? [];
  if (faqs.length > 0) out.push(faqSchema(faqs));
  if (['guides', 'alternatives', 'costs', 'compatibility'].includes(page.template)) {
    out.push(productSchema('RecoveryStack Smart Ring', page.meta_description, `${SITE}/ring`));
  }

  return out;
}
