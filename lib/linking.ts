import type { InternalLink, TemplateType } from '@/lib/types';

type LinkInput = {
  pageId: string;
  slug: string;
  template: string;
  primary_keyword: string | null;
  secondary_keywords?: string[] | null;
  query_targets?: string[] | null;
  pillar_id: string | null;
  published_at?: string | null;
  updated_at?: string | null;
};

const GENERIC_ANCHOR_PATTERNS = [
  /^click here$/i,
  /^read more$/i,
  /^learn more$/i,
  /^here$/i,
  /^this article$/i,
  /^this guide$/i,
  /^visit page$/i,
  /^more$/i,
  /^link$/i,
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenizeKeywords(page: LinkInput): Set<string> {
  const raw = [page.primary_keyword ?? '', ...(page.secondary_keywords ?? []), ...(page.query_targets ?? [])].join(' ');
  const tokens = normalizeText(raw)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
  return new Set(tokens);
}

function keywordOverlapScore(source: Set<string>, target: Set<string>): number {
  if (!source.size || !target.size) return 0;
  let overlap = 0;
  for (const token of source) {
    if (target.has(token)) overlap += 1;
  }
  return overlap / Math.max(source.size, 1);
}

function recencyScore(page: LinkInput): number {
  const stamp = page.published_at ?? page.updated_at;
  if (!stamp) return 0;
  const millis = Date.parse(stamp);
  if (!Number.isFinite(millis)) return 0;

  const ageDays = Math.max(0, (Date.now() - millis) / (1000 * 60 * 60 * 24));
  return 1 / (1 + ageDays / 30);
}

function templateAffinity(source: LinkInput, target: LinkInput): number {
  if (source.template === target.template) return 1;
  if (target.template === 'pillars') return 0.9;
  return 0.35;
}

function compareByScoreDesc(a: { score: number; recency: number; slug: string }, b: { score: number; recency: number; slug: string }): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.recency !== a.recency) return b.recency - a.recency;
  return a.slug.localeCompare(b.slug);
}

export function isGenericAnchor(anchor: string): boolean {
  const normalized = normalizeText(anchor);
  if (!normalized) return true;
  return GENERIC_ANCHOR_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildClusterLinks(
  current: LinkInput,
  all: LinkInput[],
  pillarSlug: string,
): { up: InternalLink; sideways: InternalLink[] } {
  const sourceTokens = tokenizeKeywords(current);

  const up: InternalLink = {
    slug: pillarSlug,
    template: 'pillars',
    anchor: `${(current.primary_keyword ?? 'recovery').trim()} pillar guide`,
  };

  const siblings = all
    .filter((p) => p.pageId !== current.pageId && p.template !== 'pillars' && p.pillar_id === current.pillar_id)
    .filter((p) => (p.primary_keyword ?? '').trim().length > 0)
    .map((candidate) => {
      const targetTokens = tokenizeKeywords(candidate);
      const overlap = keywordOverlapScore(sourceTokens, targetTokens);
      const recency = recencyScore(candidate);
      const template = templateAffinity(current, candidate);
      const score = overlap * 0.6 + recency * 0.25 + template * 0.15;
      return { candidate, score, recency };
    })
    .sort((a, b) => compareByScoreDesc({ score: a.score, recency: a.recency, slug: a.candidate.slug }, { score: b.score, recency: b.recency, slug: b.candidate.slug }))
    .slice(0, 5)
    .map(({ candidate }) => ({
      slug: candidate.slug,
      template: candidate.template as TemplateType,
      anchor: (candidate.primary_keyword as string).trim(),
    }));

  return { up, sideways: siblings };
}

export function buildPillarDownLinks(clusterPages: LinkInput[]): InternalLink[] {
  return clusterPages
    .filter((p) => (p.primary_keyword ?? '').trim().length > 0)
    .map((page) => ({ page, recency: recencyScore(page) }))
    .sort((a, b) => compareByScoreDesc({ score: a.recency, recency: a.recency, slug: a.page.slug }, { score: b.recency, recency: b.recency, slug: b.page.slug }))
    .slice(0, 10)
    .map(({ page }) => ({ slug: page.slug, template: page.template as TemplateType, anchor: (page.primary_keyword as string).trim() }));
}
