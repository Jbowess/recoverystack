import type { Metadata } from 'next';
import { PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';
import type { InternalLink, PageRecord } from '@/lib/types';
import { getEditorialMetadata } from '@/lib/editorial';
import { articleSchema, breadcrumbSchema, faqSchema, productSchema, newsArticleSchema, howToSchema, aggregateRatingSchema, itemListSchema, speakableSchema, medicalWebPageSchema, organizationSchema, personSchema } from '@/lib/schema-org';

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
  const ogImage = typeof page.metadata?.hero_image === 'string' && page.metadata.hero_image.trim()
    ? page.metadata.hero_image
    : `${url}/opengraph-image`;
  const imageAlt = typeof page.metadata?.hero_image_alt === 'string' && page.metadata.hero_image_alt.trim()
    ? page.metadata.hero_image_alt
    : page.title;
  const editorial = getEditorialMetadata(page);

  return {
    title: page.title,
    description: page.meta_description,
    alternates: {
      canonical: url,
      ...(page.template === 'news' ? { types: { 'application/rss+xml': `${SITE}/api/news-rss` } } : {}),
    },
    authors: [{ name: editorial.author.name, url: `${SITE}/authors/${editorial.author.slug}` }],
    openGraph: {
      type: 'article',
      url,
      title: page.title,
      description: page.meta_description,
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1200, height: 630, alt: imageAlt }],
      ...(page.published_at ? { publishedTime: page.published_at } : {}),
      modifiedTime: page.updated_at,
      authors: [editorial.author.name],
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
  const authorSlug = typeof page.metadata?.author_slug === 'string' ? page.metadata.author_slug : 'editorial-team';
  const authorName = typeof page.metadata?.author_name === 'string' ? page.metadata.author_name : 'RecoveryStack Editorial Team';
  const authorTitle = typeof page.metadata?.author_title === 'string' ? page.metadata.author_title : 'Sports Science & Recovery Technology Analysts';
  const reviewerSlug = typeof page.metadata?.reviewer_slug === 'string' ? page.metadata.reviewer_slug : null;
  const reviewerName = typeof page.metadata?.reviewer_name === 'string' ? page.metadata.reviewer_name : null;
  const reviewerTitle = typeof page.metadata?.reviewer_title === 'string' ? page.metadata.reviewer_title : 'Clinical and Evidence Review';

  out.push(organizationSchema());
  out.push(personSchema({ slug: authorSlug, name: authorName, title: authorTitle }));
  if (reviewerSlug && reviewerName) {
    out.push(personSchema({ slug: reviewerSlug, name: reviewerName, title: reviewerTitle }));
  }

  // Use NewsArticle for news and trends; standard Article for everything else
  if (page.template === 'news' || page.template === 'trends') {
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
    const productUrl = typeof page.metadata?.product_destination_url === 'string'
      ? page.metadata.product_destination_url
      : PRODUCT_DESTINATION_URL;
    out.push(productSchema(PRODUCT_NAME, page.meta_description, productUrl, price));
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
