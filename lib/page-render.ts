import type { InternalLink, PageRecord } from '@/lib/types';
import { articleSchema, breadcrumbSchema, faqSchema, productSchema } from '@/lib/schema-org';

export function splitInternalLinks(page: PageRecord): { pillarLink: InternalLink | null; siblingLinks: InternalLink[] } {
  const links = page.internal_links ?? [];
  const pillar = links.find((l) => l.template === 'pillars') ?? null;
  const siblings = links.filter((l) => l.template !== 'pillars').slice(0, 5);
  return { pillarLink: pillar, siblingLinks: siblings };
}

export function buildSchemaBundle(page: PageRecord, path: string) {
  const site = process.env.SITE_URL ?? 'https://recoverystack.io';
  const url = `${site}${path}`;
  const out: unknown[] = [];

  out.push(articleSchema(page, url));
  out.push(
    breadcrumbSchema([
      { name: 'Home', url: site },
      { name: page.template, url: `${site}/${page.template}` },
      { name: page.title, url },
    ]),
  );

  const faqs = page.body_json?.faqs ?? [];
  if (faqs.length > 0) out.push(faqSchema(faqs));
  if (['guides', 'alternatives', 'costs', 'compatibility'].includes(page.template)) {
    out.push(productSchema('RecoveryStack Smart Ring', page.meta_description, `${site}/ring`));
  }

  return out;
}
