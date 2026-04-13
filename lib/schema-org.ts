import type { PageRecord } from '@/lib/types';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

const ORGANIZATION = {
  '@type': 'Organization' as const,
  name: 'RecoveryStack',
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject' as const,
    url: `${SITE_URL}/logo.png`,
  },
  sameAs: [
    'https://twitter.com/recoverystack',
    'https://www.instagram.com/recoverystack',
  ],
};

const AUTHOR = {
  '@type': 'Person' as const,
  name: 'RecoveryStack Editorial Team',
  url: `${SITE_URL}/about`,
  jobTitle: 'Sports Science & Recovery Technology Analysts',
  worksFor: ORGANIZATION,
};

export const organizationSchema = () => ({
  '@context': 'https://schema.org',
  ...ORGANIZATION,
});

export const articleSchema = (page: PageRecord, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: page.title,
  description: page.meta_description,
  url,
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  datePublished: page.published_at ?? page.updated_at,
  dateModified: page.updated_at,
  author: AUTHOR,
  publisher: ORGANIZATION,
  image: `${url}/opengraph-image`,
});

export const newsArticleSchema = (page: PageRecord, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: page.title,
  description: page.meta_description,
  url,
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  datePublished: page.published_at ?? page.updated_at,
  dateModified: page.updated_at,
  author: AUTHOR,
  publisher: ORGANIZATION,
  image: `${url}/opengraph-image`,
});

export const howToSchema = (page: PageRecord, url: string) => {
  const sections = page.body_json?.sections ?? [];
  const steps = sections
    .filter((s) => s.kind === 'steps' || s.kind === 'paragraphs')
    .slice(0, 10)
    .map((section, idx) => {
      const text = Array.isArray(section.content)
        ? (section.content as string[]).join(' ')
        : typeof section.content === 'string'
          ? section.content
          : section.heading;
      return {
        '@type': 'HowToStep' as const,
        position: idx + 1,
        name: section.heading,
        text: typeof text === 'string' ? text.slice(0, 500) : section.heading,
      };
    });

  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: page.title,
    description: page.meta_description,
    step: steps,
    image: `${url}/opengraph-image`,
  };
};

export const breadcrumbSchema = (items: Array<{ name: string; url: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((i, idx) => ({ '@type': 'ListItem', position: idx + 1, name: i.name, item: i.url })),
});

export const faqSchema = (faqs: Array<{ q: string; a: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

export const productSchema = (
  name: string,
  description: string,
  url: string,
  price?: number | null,
  priceCurrency = 'AUD',
) => {
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    brand: { '@type': 'Brand', name: 'RecoveryStack' },
    url,
  };

  // Only emit offers when a real price is available — otherwise Google's
  // Product rich-result validator rejects the schema for missing price.
  if (price != null && Number.isFinite(price) && price > 0) {
    base.offers = {
      '@type': 'Offer',
      url,
      price: price.toFixed(2),
      priceCurrency,
      availability: 'https://schema.org/InStock',
    };
  }

  return base;
};

export const personSchema = (author: {
  slug: string;
  name: string;
  title: string;
  bio?: string | null;
  credentials?: string[] | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  avatar_url?: string | null;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: author.name,
  jobTitle: author.title,
  url: `${SITE_URL}/authors/${author.slug}`,
  description: author.bio ?? undefined,
  image: author.avatar_url ?? undefined,
  ...(author.credentials?.length
    ? {
        hasCredential: author.credentials.map((c) => ({
          '@type': 'EducationalOccupationalCredential',
          credentialCategory: c,
        })),
      }
    : {}),
  sameAs: [author.linkedin_url, author.twitter_url].filter(Boolean),
  worksFor: ORGANIZATION,
});

export const aggregateRatingSchema = (
  name: string,
  ratingValue: number,
  ratingCount: number,
  url: string,
) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name,
  url,
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue,
    ratingCount,
    bestRating: 5,
    worstRating: 1,
  },
});
