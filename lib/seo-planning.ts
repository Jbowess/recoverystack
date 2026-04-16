import type { PageRecord } from '@/lib/types';

export type QueryTargetRow = {
  page_id: string;
  page_slug: string;
  query: string;
  normalized_query: string;
  intent: string;
  source: string;
  priority: number;
  search_volume?: number | null;
  keyword_difficulty?: number | null;
  current_ctr?: number | null;
  current_position?: number | null;
  is_primary?: boolean;
  cluster_label?: string | null;
  metadata?: Record<string, unknown>;
};

export type ReferenceRow = {
  page_id: string;
  page_slug: string;
  title: string;
  url: string;
  source_domain?: string | null;
  source_type: string;
  authority_score: number;
  evidence_level: string;
  published_at?: string | null;
  metadata?: Record<string, unknown>;
};

export function normalizeSeoText(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function inferQueryIntent(query: string) {
  const lower = query.toLowerCase();
  if (/\b(vs|alternative|compare|best|review|worth it|buy|price|cost)\b/.test(lower)) return 'commercial';
  if (/\b(how to|protocol|routine|plan|guide|setup)\b/.test(lower)) return 'instructional';
  if (/\b(what is|why|when|meaning|explained)\b/.test(lower)) return 'informational';
  return 'informational';
}

export function deriveWordCountTarget(
  page: Pick<PageRecord, 'template'>,
  queryCount: number,
  referenceCount: number,
  briefTarget?: number | null,
) {
  const baseByTemplate: Record<string, number> = {
    pillars: 2200,
    guides: 1800,
    alternatives: 1900,
    reviews: 2200,
    protocols: 1600,
    metrics: 1500,
    costs: 1400,
    compatibility: 1500,
    trends: 1300,
    checklists: 1200,
  };

  const base = baseByTemplate[page.template] ?? 1400;
  const queryLift = Math.min(900, Math.max(0, queryCount - 3) * 120);
  const referenceLift = Math.min(400, referenceCount * 40);
  const target = base + queryLift + referenceLift;

  return Math.max(target, briefTarget ?? 0);
}

export function scoreReferenceAuthority(url: string) {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    if (/(nih\.gov|pubmed\.ncbi\.nlm\.nih\.gov|who\.int|fda\.gov|bmj\.com|thelancet\.com|nejm\.org)/i.test(domain)) return 95;
    if (/(gov|edu)$/i.test(domain)) return 90;
    if (/(nature\.com|sciencedirect\.com|jamanetwork\.com|springer\.com)/i.test(domain)) return 88;
    if (/(reddit\.com|youtube\.com|x\.com|twitter\.com)/i.test(domain)) return 35;
    return 60;
  } catch {
    return 40;
  }
}

export function buildReferenceRow(
  pageId: string,
  pageSlug: string,
  item: { title: string; url: string; source_type?: string; evidence_level?: string; published_at?: string | null; metadata?: Record<string, unknown> },
): ReferenceRow {
  let sourceDomain: string | null = null;
  try {
    sourceDomain = new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    sourceDomain = null;
  }

  return {
    page_id: pageId,
    page_slug: pageSlug,
    title: item.title,
    url: item.url,
    source_domain: sourceDomain,
    source_type: item.source_type ?? 'editorial_reference',
    authority_score: scoreReferenceAuthority(item.url),
    evidence_level: item.evidence_level ?? 'supporting',
    published_at: item.published_at ?? null,
    metadata: item.metadata ?? {},
  };
}

export function computeSeoQualityScore(input: {
  wordCount: number;
  queryCount: number;
  referenceCount: number;
  visualCount: number;
  internalLinkCount: number;
}) {
  const breakdown = {
    depth: Math.min(30, Math.round(input.wordCount / 80)),
    queryCoverage: Math.min(20, input.queryCount * 3),
    evidence: Math.min(20, input.referenceCount * 4),
    visuals: Math.min(15, input.visualCount * 5),
    links: Math.min(15, input.internalLinkCount * 2),
  };

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { total, breakdown };
}
