import { getLlmAnswerSection, normalizeDiscoveryQuery, parseLlmAnswerContent } from '@/lib/llm-discovery';
import type { PageRecord } from '@/lib/types';

export type CrawlerFamily =
  | 'oai-searchbot'
  | 'gptbot'
  | 'chatgpt-user'
  | 'googlebot'
  | 'bingbot'
  | 'perplexitybot'
  | 'claudebot'
  | 'duckassistbot'
  | 'applebot'
  | 'bytespider'
  | 'other_bot';

type CrawlerMatcher = {
  family: CrawlerFamily;
  patterns: RegExp[];
};

const CRAWLER_MATCHERS: CrawlerMatcher[] = [
  { family: 'oai-searchbot', patterns: [/oai-searchbot/i] },
  { family: 'gptbot', patterns: [/gptbot/i] },
  { family: 'chatgpt-user', patterns: [/chatgpt-user/i] },
  { family: 'perplexitybot', patterns: [/perplexitybot/i, /perplexity-user/i] },
  { family: 'claudebot', patterns: [/claudebot/i, /anthropic-ai/i] },
  { family: 'googlebot', patterns: [/googlebot/i] },
  { family: 'bingbot', patterns: [/bingbot/i, /bingpreview/i] },
  { family: 'duckassistbot', patterns: [/duckassistbot/i] },
  { family: 'applebot', patterns: [/applebot/i] },
  { family: 'bytespider', patterns: [/bytespider/i] },
];

export function detectCrawlerFamily(userAgent?: string | null): CrawlerFamily | null {
  const value = userAgent?.trim();
  if (!value) return null;

  for (const matcher of CRAWLER_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(value))) {
      return matcher.family;
    }
  }

  if (/bot|crawler|spider|preview|fetcher|slurp/i.test(value)) {
    return 'other_bot';
  }

  return null;
}

export function buildPromptKey(channel: string, promptText: string, pageSlug?: string | null) {
  const normalized = normalizeDiscoveryQuery(promptText);
  return `${channel.toLowerCase()}::${pageSlug ?? 'general'}::${normalized}`.slice(0, 180);
}

export function latestSnapshotMap<T extends { dataset_key: string; snapshot_date: string }>(rows: T[]) {
  const out = new Map<string, T>();
  for (const row of rows) {
    const current = out.get(row.dataset_key);
    if (!current || new Date(row.snapshot_date).getTime() > new Date(current.snapshot_date).getTime()) {
      out.set(row.dataset_key, row);
    }
  }
  return out;
}

export function extractDatasetKeysBySlug(rows: Array<{ dataset_key: string; data?: unknown }>) {
  const out = new Map<string, string[]>();

  for (const row of rows) {
    if (!Array.isArray(row.data)) continue;
    for (const item of row.data) {
      if (!item || typeof item !== 'object') continue;
      const slug = typeof (item as Record<string, unknown>).slug === 'string'
        ? String((item as Record<string, unknown>).slug)
        : null;
      if (!slug) continue;
      const current = out.get(slug) ?? [];
      if (!current.includes(row.dataset_key)) current.push(row.dataset_key);
      out.set(slug, current);
    }
  }

  return out;
}

export type CommercialAuditResult = {
  score: number;
  status: 'strong' | 'needs_work' | 'critical';
  isCommercial: boolean;
  presentFields: string[];
  missingFields: string[];
  notes: string[];
};

function flattenUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenUnknown).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(flattenUnknown).join(' ');
  return '';
}

function hasTableSection(page: Pick<PageRecord, 'body_json'>) {
  if (Array.isArray(page.body_json?.comparison_table?.rows) && Array.isArray(page.body_json?.comparison_table?.headers)) return true;
  return (page.body_json?.sections ?? []).some((section) => section.kind === 'table');
}

function hasPriceSignal(text: string, hasProductData: boolean) {
  return hasProductData || /\b(price|pricing|cost|subscription|year one cost|usd|aud|\$\d+)/i.test(text);
}

function hasPlatformSignal(text: string, template: string) {
  return template === 'compatibility' || /\b(iphone|android|ios|platform|compatib|garmin|apple watch)\b/i.test(text);
}

function hasUseCaseSignal(text: string, bestFor: string | null | undefined) {
  return Boolean(bestFor) || /\b(best for|ideal for|avoid if|who it'?s for|who it'?s not for)\b/i.test(text);
}

export function isCommercialTemplate(template: string) {
  return ['alternatives', 'reviews', 'costs', 'compatibility', 'guides'].includes(template);
}

export function buildCommercialAudit(input: {
  page: Pick<PageRecord, 'template' | 'title' | 'meta_description' | 'primary_keyword' | 'body_json' | 'metadata'>;
  referencesCount: number;
  visualsCount: number;
  queryCount: number;
  claimCount: number;
  hasProductData: boolean;
}) : CommercialAuditResult {
  const text = [
    input.page.title,
    input.page.meta_description,
    input.page.primary_keyword ?? '',
    flattenUnknown(input.page.body_json),
  ].join(' ');

  const llmAnswer = parseLlmAnswerContent(getLlmAnswerSection(input.page)?.content);
  const isCommercial = isCommercialTemplate(input.page.template)
    || /\b(compare|comparison|best|alternative|review|price|cost|subscription|compatib)\b/i.test(text);

  const checks = [
    { key: 'llm_answer', present: Boolean(llmAnswer), points: 12, required: isCommercial },
    { key: 'comparison_table', present: hasTableSection(input.page), points: 12, required: isCommercial && input.page.template !== 'compatibility' },
    { key: 'methodology', present: Boolean(input.page.body_json?.review_methodology), points: 10, required: isCommercial },
    { key: 'references', present: input.referencesCount >= 3, points: 10, required: true },
    { key: 'verdict', present: (input.page.body_json?.verdict ?? []).length > 0, points: 8, required: isCommercial },
    { key: 'visuals', present: input.visualsCount > 0, points: 8, required: isCommercial },
    { key: 'query_targets', present: input.queryCount > 0, points: 6, required: true },
    { key: 'claims', present: input.claimCount > 0, points: 6, required: isCommercial },
    { key: 'product_data', present: input.hasProductData, points: 10, required: isCommercial },
    { key: 'price_context', present: hasPriceSignal(text, input.hasProductData), points: 9, required: isCommercial },
    { key: 'platform_context', present: hasPlatformSignal(text, input.page.template), points: 5, required: input.page.template === 'compatibility' },
    { key: 'use_case_split', present: hasUseCaseSignal(text, llmAnswer?.best_for), points: 8, required: isCommercial },
  ];

  let score = 24;
  const presentFields: string[] = [];
  const missingFields: string[] = [];

  for (const check of checks) {
    if (check.present) {
      presentFields.push(check.key);
      score += check.points;
    } else if (check.required) {
      missingFields.push(check.key);
    }
  }

  score = Math.max(0, Math.min(100, score));

  const notes: string[] = [];
  if (isCommercial && !presentFields.includes('product_data')) {
    notes.push('Commercial page is missing explicit product-spec coverage.');
  }
  if (isCommercial && !presentFields.includes('price_context')) {
    notes.push('Commercial page does not clearly expose price or subscription framing.');
  }
  if (input.page.template === 'compatibility' && !presentFields.includes('platform_context')) {
    notes.push('Compatibility page is missing platform-specific context.');
  }
  if (missingFields.length >= 4) {
    notes.push('Page is missing several decision-support signals that assistants and buyers look for.');
  }

  let status: CommercialAuditResult['status'] = 'strong';
  if (score < 82) status = 'needs_work';
  if (score < 60) status = 'critical';

  return {
    score,
    status,
    isCommercial,
    presentFields,
    missingFields,
    notes,
  };
}
