import type { PageRecord } from '@/lib/types';

export const articleSchema = (page: PageRecord, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: page.title,
  description: page.meta_description,
  mainEntityOfPage: url,
  dateModified: page.updated_at,
  publisher: { '@type': 'Organization', name: 'RecoveryStack.io' },
});

export const breadcrumbSchema = (items: Array<{ name: string; url: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((i, idx) => ({ '@type': 'ListItem', position: idx + 1, name: i.name, item: i.url })),
});

export const faqSchema = (faqs: Array<{ q: string; a: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

export const productSchema = (name: string, description: string, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name,
  description,
  brand: { '@type': 'Brand', name: 'RecoveryStack' },
  url,
});
