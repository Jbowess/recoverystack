import type { PageRecord } from '@/lib/types';

const PUBLISHER = {
  '@type': 'Organization' as const,
  name: 'RecoveryStack.io',
  url: process.env.SITE_URL ?? 'https://recoverystack.io',
};

export const articleSchema = (page: PageRecord, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: page.title,
  description: page.meta_description,
  url,
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  datePublished: page.published_at ?? page.updated_at,
  dateModified: page.updated_at,
  author: PUBLISHER,
  publisher: PUBLISHER,
  image: `${url}/opengraph-image`,
});

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

export const productSchema = (name: string, description: string, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name,
  description,
  brand: { '@type': 'Brand', name: 'RecoveryStack' },
  url,
  offers: {
    '@type': 'Offer',
    url,
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
  },
});
