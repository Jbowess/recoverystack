import type { Metadata } from 'next';
import type { InternalLink, PageRecord } from '@/lib/types';
import { articleSchema, breadcrumbSchema, faqSchema, productSchema, newsArticleSchema, howToSchema, aggregateRatingSchema, itemListSchema, speakableSchema, medicalWebPageSchema } from '@/lib/schema-org';

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

  // Use NewsArticle for trends, standard Article for everything else
  if (page.template === 'trends') {
    out.push(newsArticleSchema(page, url));
  } else {
    out.push(articleSchema(page, url));
  }

  out.push(
    breadcrumbSchema([
      { name: 'Home', url: SITE },
      { name: titleCase(page.template), url: `${SITE}/${page.template}` },
      { name: page.title, url },
    ]),
  );

  // HowTo schema for protocols
  if (page.template === 'protocols') {
    out.push(howToSchema(page, url));
  }

  const faqs = page.body_json?.faqs ?? [];
  if (faqs.length > 0) out.push(faqSchema(faqs));
  if (['guides', 'alternatives', 'costs', 'compatibility'].includes(page.template)) {
    const price = typeof page.metadata?.price === 'number' ? page.metadata.price : null;
    out.push(productSchema('RecoveryStack Smart Ring', page.meta_description, `${SITE}/ring`, price));
  }

  // AggregateRating for alternatives and reviews — shown in SERP star snippets
  if (page.template === 'alternatives' || page.template === 'reviews') {
    const rv = page.metadata?.rating_value;
    const rc = page.metadata?.rating_count;
    if (typeof rv === 'number' && typeof rc === 'number' && rv > 0 && rc > 0) {
      out.push(aggregateRatingSchema(page.title, rv, rc, url));
    }
  }

  // ItemList schema for checklists — improves rich result eligibility
  if (page.template === 'checklists') {
    const sections = page.body_json?.sections ?? [];
    const listItems: string[] = [];
    for (const section of sections) {
      const content = section.content as { items?: unknown[] } | unknown;
      if (section.kind === 'list' && content && typeof content === 'object' && Array.isArray((content as { items?: unknown[] }).items)) {
        for (const item of (content as { items: unknown[] }).items) {
          if (typeof item === 'string') listItems.push(item);
        }
      }
    }
    if (listItems.length > 0) {
      out.push(itemListSchema(page.title, listItems.slice(0, 20), url));
    }
  }

  // MedicalWebPage schema for E-E-A-T on health/clinical content
  if (page.template === 'protocols' || page.template === 'metrics') {
    out.push(medicalWebPageSchema(page, url));
  }

  // SpeakableSpecification — voice search / Google Assistant eligibility
  out.push(speakableSchema(url));

  return out;
}
