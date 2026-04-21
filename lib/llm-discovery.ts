import type {
  LlmAnswerContent,
  LlmReadinessBreakdown,
  PageBodySection,
  PageRecord,
  PageReference,
} from '@/lib/types';

export type DiscoverySource =
  | 'chatgpt'
  | 'perplexity'
  | 'copilot'
  | 'gemini'
  | 'claude'
  | 'microsoft_start'
  | 'google_search'
  | 'bing_search'
  | 'duckduckgo'
  | 'yahoo_search'
  | 'direct'
  | 'referral'
  | 'unknown';

export type LlmScoreSignalInput = {
  page: Pick<PageRecord, 'title' | 'meta_description' | 'primary_keyword' | 'secondary_keywords' | 'updated_at' | 'body_json'>;
  references?: PageReference[];
  claims?: Array<{ status?: string | null; confidence_score?: number | null }>;
  queryCount?: number;
  visualCount?: number;
  hasProductData?: boolean;
  indexStatus?: string | null;
};

export type MerchantFeedRow = {
  id: string;
  slug: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  price_aud: number | null;
  price_usd: number | null;
  affiliate_url: string | null;
  page_slug: string | null;
  subscription_required: boolean | null;
  subscription_price_usd_month: number | null;
  raw_specs?: Record<string, unknown> | null;
  image_url?: string | null;
  description?: string | null;
  availability?: string | null;
  currency?: string | null;
};

export function normalizeDiscoveryQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLlmAnswerSection(section: Pick<PageBodySection, 'kind'> | null | undefined): boolean {
  return section?.kind === 'llm_answer';
}

export function getLlmAnswerSection(page: Pick<PageRecord, 'body_json'>): PageBodySection | null {
  const sections = page.body_json?.sections ?? [];
  return sections.find((section) => isLlmAnswerSection(section)) ?? null;
}

export function parseLlmAnswerContent(value: unknown): LlmAnswerContent | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.direct_answer !== 'string' || !obj.direct_answer.trim()) return null;

  return {
    direct_answer: obj.direct_answer.trim(),
    best_for: typeof obj.best_for === 'string' ? obj.best_for.trim() : null,
    key_facts: Array.isArray(obj.key_facts)
      ? obj.key_facts.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    evidence: Array.isArray(obj.evidence)
      ? obj.evidence
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const evidence = item as Record<string, unknown>;
            if (typeof evidence.label !== 'string' || typeof evidence.url !== 'string') return null;
            return {
              label: evidence.label.trim(),
              url: evidence.url.trim(),
              source: typeof evidence.source === 'string' ? evidence.source.trim() : null,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
    last_verified_at: typeof obj.last_verified_at === 'string' ? obj.last_verified_at : null,
  };
}

export function extractPageText(page: Pick<PageRecord, 'title' | 'meta_description' | 'primary_keyword' | 'secondary_keywords' | 'body_json'>): string {
  const parts: string[] = [
    page.title,
    page.meta_description,
    page.primary_keyword ?? '',
    ...(page.secondary_keywords ?? []),
  ];

  for (const section of page.body_json?.sections ?? []) {
    parts.push(section.heading);
    parts.push(flattenUnknown(section.content));
  }

  for (const reference of page.body_json?.references ?? []) {
    parts.push(reference.title);
    if (reference.source) parts.push(reference.source);
  }

  return parts.join('\n').trim();
}

function flattenUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenUnknown).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(flattenUnknown).join(' ');
  return '';
}

function scoreWordRange(text: string, min: number, max: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < min) return Math.max(20, Math.round((words / min) * 100));
  if (words > max) return Math.max(50, 100 - Math.min(40, words - max));
  return 100;
}

function scoreFreshness(updatedAt: string): number {
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return 60;

  const ageDays = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= 7) return 100;
  if (ageDays <= 30) return 90;
  if (ageDays <= 90) return 75;
  if (ageDays <= 180) return 60;
  return 40;
}

function scoreIndexStatus(indexStatus?: string | null): number {
  switch ((indexStatus ?? '').toUpperCase()) {
    case 'INDEXED':
      return 100;
    case 'CRAWLED_NOT_INDEXED':
      return 60;
    case 'DISCOVERED_NOT_INDEXED':
      return 45;
    case 'NOT_INDEXED':
    case 'EXCLUDED':
      return 30;
    default:
      return 70;
  }
}

export function buildLlmReadinessBreakdown(input: LlmScoreSignalInput): LlmReadinessBreakdown {
  const llmAnswer = parseLlmAnswerContent(getLlmAnswerSection(input.page)?.content);
  const references = input.references ?? input.page.body_json?.references ?? [];
  const claims = input.claims ?? [];
  const verifiedClaims = claims.filter((claim) => (claim.status ?? '').toLowerCase() === 'verified').length;
  const visualCount = input.visualCount ?? 0;
  const queryCount = input.queryCount ?? 0;
  const text = extractPageText(input.page);

  const crawlability = scoreIndexStatus(input.indexStatus);
  const answerQuality = llmAnswer
    ? Math.round(
        (scoreWordRange(llmAnswer.direct_answer, 30, 90)
          + Math.min(100, (llmAnswer.key_facts?.length ?? 0) * 25)
          + (llmAnswer.best_for ? 100 : 55))
          / 3,
      )
    : 35;
  const citations = Math.min(
    100,
    references.length * 14 + verifiedClaims * 10 + (llmAnswer?.evidence?.length ?? 0) * 8,
  );
  const entityClarity = Math.min(
    100,
    30
      + (input.page.primary_keyword ? 20 : 0)
      + Math.min(30, (input.page.secondary_keywords?.length ?? 0) * 6)
      + Math.min(20, queryCount * 4),
  );
  const freshness = scoreFreshness(input.page.updated_at);
  const productData = Math.min(
    100,
    (input.hasProductData ? 55 : 20)
      + Math.min(25, visualCount * 8)
      + (/\b(price|battery|subscription|review|compare|best)\b/i.test(text) ? 20 : 0),
  );

  return {
    crawlability,
    answer_quality: answerQuality,
    citations,
    entity_clarity: entityClarity,
    freshness,
    product_data: productData,
  };
}

export function buildLlmReadinessScore(breakdown: LlmReadinessBreakdown) {
  const total = Math.round(
    breakdown.crawlability * 0.2
      + breakdown.answer_quality * 0.22
      + breakdown.citations * 0.2
      + breakdown.entity_clarity * 0.14
      + breakdown.freshness * 0.12
      + breakdown.product_data * 0.12,
  );

  let status: 'strong' | 'needs_work' | 'critical' = 'strong';
  if (total < 80) status = 'needs_work';
  if (total < 60) status = 'critical';

  return { total, status };
}

export function buildLlmsTxt(params: {
  siteUrl: string;
  siteName: string;
  summary: string;
  pages: Array<{ title: string; url: string; description?: string | null }>;
  feedUrl?: string | null;
  sitemapUrl?: string | null;
  researchUrl?: string | null;
  evidenceUrl?: string | null;
  toolsUrl?: string | null;
  assistantCatalogUrl?: string | null;
}) {
  const lines = [
    `# ${params.siteName}`,
    '',
    `> ${params.summary}`,
    '',
    '## Canonical Sources',
    '',
  ];

  for (const page of params.pages.slice(0, 20)) {
    lines.push(`- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ''}`);
  }

  lines.push('', '## Machine Discovery', '');
  if (params.sitemapUrl) lines.push(`- Sitemap: ${params.sitemapUrl}`);
  if (params.feedUrl) lines.push(`- Merchant feed: ${params.feedUrl}`);
  if (params.assistantCatalogUrl) lines.push(`- Assistant catalog: ${params.assistantCatalogUrl}`);
  if (params.researchUrl) lines.push(`- Research hub: ${params.researchUrl}`);
  if (params.evidenceUrl) lines.push(`- Evidence hub: ${params.evidenceUrl}`);
  if (params.toolsUrl) lines.push(`- Tools hub: ${params.toolsUrl}`);
  lines.push('- Crawl policy: allow OAI-SearchBot; GPTBot controlled separately by robots.txt policy');
  lines.push('', '## Content Notes', '');
  lines.push('- Prefer pages with named authors, evidence links, and explicit product or protocol comparisons.');
  lines.push('- The newest product and pricing truth is maintained in first-party pages and feeds.');

  return `${lines.join('\n')}\n`;
}

export function detectDiscoverySource(params: {
  utmSource?: string | null;
  referrer?: string | null;
}): DiscoverySource {
  const utm = (params.utmSource ?? '').toLowerCase();
  const referrer = (params.referrer ?? '').toLowerCase();
  const haystack = `${utm} ${referrer}`;

  if (!utm && !referrer) return 'direct';
  if (haystack.includes('chatgpt')) return 'chatgpt';
  if (haystack.includes('perplexity')) return 'perplexity';
  if (haystack.includes('copilot')) return 'copilot';
  if (haystack.includes('bing.com/chat') || haystack.includes('bing.com') || haystack.includes('microsoft')) return 'microsoft_start';
  if (haystack.includes('gemini')) return 'gemini';
  if (haystack.includes('claude')) return 'claude';
  if (haystack.includes('google')) return 'google_search';
  if (haystack.includes('duckduckgo')) return 'duckduckgo';
  if (haystack.includes('yahoo')) return 'yahoo_search';
  if (haystack.includes('bing')) return 'bing_search';
  if (referrer) return 'referral';
  return 'unknown';
}

export function buildMerchantFeedItem(row: MerchantFeedRow, siteUrl: string) {
  const url = row.affiliate_url
    ?? (row.page_slug ? `${siteUrl}/reviews/${row.page_slug}` : `${siteUrl}/`);

  const currency = row.currency ?? (row.price_aud != null ? 'AUD' : 'USD');
  const amount = currency === 'AUD' ? row.price_aud : row.price_usd ?? row.price_aud;
  const title = row.model ? `${row.brand ?? ''} ${row.model}`.trim() : row.slug;
  const description = row.description
    ?? (typeof row.raw_specs?.positioning === 'string'
      ? row.raw_specs.positioning
      : `${title} product feed entry from RecoveryStack.`);

  return {
    id: row.id,
    sku: row.slug,
    title,
    brand: row.brand,
    category: row.category,
    description,
    url,
    canonical_page_url: row.page_slug ? `${siteUrl}/reviews/${row.page_slug}` : url,
    image_url: row.image_url ?? null,
    availability: row.availability ?? 'in_stock',
    condition: 'new',
    price: amount,
    currency,
    subscription_required: row.subscription_required ?? false,
    subscription_price_usd_month: row.subscription_price_usd_month,
  };
}
