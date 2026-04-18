type SourceCategory =
  | 'brand_press'
  | 'publisher'
  | 'research_primary'
  | 'research_secondary'
  | 'regulatory'
  | 'community'
  | 'video'
  | 'commerce'
  | 'unknown';

type SourceTaxonomy = {
  category: SourceCategory;
  label: string;
};

type ExtractedQuote = {
  text: string;
  speaker?: string | null;
};

type ExtractedMetric = {
  label: string;
  value: string;
};

type ExtractedTimelinePoint = {
  label: string;
  date?: string | null;
};

type ArticleIntelligence = {
  canonicalUrl: string;
  sourceDomain: string | null;
  author: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  articleTitle: string | null;
  description: string | null;
  extractedText: string | null;
  paragraphs: string[];
  knownFacts: string[];
  unknowns: string[];
  keyClaims: string[];
  quotes: ExtractedQuote[];
  metrics: ExtractedMetric[];
  timeline: ExtractedTimelinePoint[];
};

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractMetaContent(html: string, key: string, attr: 'property' | 'name' | 'itemprop' = 'property'): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escaped}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return null;
}

function extractLinkHref(html: string, rel: string): string | null {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<link[^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${escaped}[^"']*["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return null;
}

function resolveUrl(candidate: string | null, fallback: string): string {
  if (!candidate) return fallback;
  try {
    return new URL(candidate, fallback).toString();
  } catch {
    return fallback;
  }
}

function extractBodyParagraphs(html: string): string[] {
  const articleMatch =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
    ?? html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
    ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = articleMatch?.[1] ?? html;

  const paragraphs = Array.from(body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripTags(match[1]))
    .filter((text) => text.length >= 40)
    .slice(0, 24);

  if (paragraphs.length > 0) return paragraphs;

  const text = stripTags(body);
  return text
    .split(/\.\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 60)
    .slice(0, 12)
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`));
}

function extractJsonLdObjects(html: string): unknown[] {
  const scripts = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const parsed: unknown[] = [];

  for (const script of scripts) {
    const raw = script[1]?.trim();
    if (!raw) continue;
    try {
      parsed.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD payloads.
    }
  }

  return parsed;
}

function flattenJsonLd(input: unknown): Array<Record<string, unknown>> {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap((item) => flattenJsonLd(item));
  if (typeof input !== 'object') return [];

  const row = input as Record<string, unknown>;
  const graph = row['@graph'];
  if (Array.isArray(graph)) return [row, ...graph.flatMap((item) => flattenJsonLd(item))];

  return [row];
}

function pickJsonLdArticle(rows: Array<Record<string, unknown>>): Record<string, unknown> | null {
  for (const row of rows) {
    const type = row['@type'];
    const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
    if (types.some((value) => /article|newsarticle|blogposting|medicalscholarlyarticle/i.test(value))) {
      return row;
    }
  }
  return null;
}

function safeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function splitSentences(input: string): string[] {
  return input
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30);
}

function dedupeStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value);
    if (out.length >= limit) break;
  }

  return out;
}

function extractQuotes(text: string): ExtractedQuote[] {
  const quotes = Array.from(text.matchAll(/"([^"]{25,220})"/g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((quote) => ({ text: quote }));

  return quotes;
}

function extractMetrics(sentences: string[]): ExtractedMetric[] {
  const rows: ExtractedMetric[] = [];
  const metricPattern = /(\b\d+(?:\.\d+)?\s?(?:%|hours?|days?|weeks?|months?|years?|mg|g|kg|lb|lbs|km|mi|minutes?|participants?|subjects?|users?)\b)/i;

  for (const sentence of sentences) {
    const match = sentence.match(metricPattern);
    if (!match) continue;
    rows.push({
      label: sentence.slice(0, 70).trim(),
      value: match[1],
    });
    if (rows.length >= 6) break;
  }

  return rows;
}

function extractTimeline(sentences: string[]): ExtractedTimelinePoint[] {
  const rows: ExtractedTimelinePoint[] = [];
  const datePattern = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/i;

  for (const sentence of sentences) {
    const match = sentence.match(datePattern);
    if (!match) continue;
    rows.push({
      label: sentence.slice(0, 120).trim(),
      date: safeDate(match[0]),
    });
    if (rows.length >= 6) break;
  }

  return rows;
}

function extractClaims(sentences: string[]): string[] {
  const claimLike = sentences.filter((sentence) =>
    /\b(?:launch|release|update|study|trial|found|showed|reported|announced|recall|approved|subscription|price|accuracy|improved|decreased|increased)\b/i.test(
      sentence,
    ),
  );

  return dedupeStrings(claimLike, 8);
}

function extractKnownFacts(sentences: string[]): string[] {
  const factLike = sentences.filter((sentence) =>
    /\b(?:is|are|includes|supports|offers|tracks|measures|uses|will|can|published|according to|available)\b/i.test(
      sentence,
    ),
  );

  return dedupeStrings(factLike, 8);
}

function inferUnknowns(text: string): string[] {
  const lower = text.toLowerCase();
  const unknowns: string[] = [];

  if (!/\b(?:price|pricing|\$|usd|aud|subscription)\b/.test(lower)) {
    unknowns.push('Pricing or subscription details are still unclear.');
  }
  if (!/\b(?:available|availability|ships|shipping|release date|rollout)\b/.test(lower)) {
    unknowns.push('Availability timing is not fully confirmed.');
  }
  if (!/\b(?:study|trial|participants|sample|n=|randomized)\b/.test(lower) && /\b(?:research|published|preprint)\b/.test(lower)) {
    unknowns.push('Methodology details are incomplete or not yet confirmed.');
  }
  if (!/\b(?:accuracy|validation|compared|benchmark)\b/.test(lower) && /\b(?:wearable|tracker|ring|watch|sensor)\b/.test(lower)) {
    unknowns.push('Independent validation or benchmark data is not yet clear.');
  }

  return unknowns.slice(0, 4);
}

export function inferSourceTaxonomy(domain: string | null, sourceType?: string | null): SourceTaxonomy {
  const value = (domain ?? '').toLowerCase();
  const type = (sourceType ?? '').toLowerCase();

  if (type === 'research' || /pubmed|nih\.gov|biorxiv|medrxiv|nature\.com|jamanetwork\.com|thelancet\.com/.test(value)) {
    return { category: 'research_primary', label: 'Primary research' };
  }
  if (/fda\.gov|gov$|ema\.europa\.eu/.test(value)) {
    return { category: 'regulatory', label: 'Regulatory source' };
  }
  if (/reddit\.com/.test(value) || type === 'community') {
    return { category: 'community', label: 'Community signal' };
  }
  if (/youtube\.com|youtu\.be/.test(value) || type === 'video') {
    return { category: 'video', label: 'Video source' };
  }
  if (/amazon\.|bestbuy\.|rei\.|walmart\./.test(value)) {
    return { category: 'commerce', label: 'Commerce source' };
  }
  if (/oura\.com|whoop\.com|garmin\.com|apple\.com|google\.com|samsung\.com|therabody\.com|hyperice\.com|eightsleep\.com/.test(value)) {
    return { category: 'brand_press', label: 'Brand or company source' };
  }
  if (type === 'rss' || type === 'publisher' || value) {
    return { category: 'publisher', label: 'Publisher or editorial source' };
  }

  return { category: 'unknown', label: 'Unknown source' };
}

export function extractArticleIntelligence(params: {
  html?: string | null;
  url: string;
  title: string;
  summary?: string | null;
  sourceType?: string | null;
}): ArticleIntelligence {
  const html = params.html ?? '';
  const jsonLdRows = extractJsonLdObjects(html).flatMap((item) => flattenJsonLd(item));
  const articleRow = pickJsonLdArticle(jsonLdRows);

  const canonicalUrl = resolveUrl(
    extractLinkHref(html, 'canonical')
      ?? (typeof articleRow?.url === 'string' ? articleRow.url : null)
      ?? extractMetaContent(html, 'og:url'),
    params.url,
  );

  let sourceDomain: string | null = null;
  try {
    sourceDomain = new URL(canonicalUrl).hostname.replace(/^www\./, '');
  } catch {
    sourceDomain = null;
  }

  const articleTitle =
    extractMetaContent(html, 'og:title')
    ?? extractMetaContent(html, 'twitter:title', 'name')
    ?? (typeof articleRow?.headline === 'string' ? articleRow.headline : null)
    ?? params.title;

  const description =
    extractMetaContent(html, 'description', 'name')
    ?? extractMetaContent(html, 'og:description')
    ?? (typeof articleRow?.description === 'string' ? articleRow.description : null)
    ?? params.summary
    ?? null;

  const author =
    extractMetaContent(html, 'author', 'name')
    ?? extractMetaContent(html, 'article:author')
    ?? (typeof articleRow?.author === 'string'
      ? articleRow.author
      : articleRow?.author && typeof articleRow.author === 'object' && typeof (articleRow.author as Record<string, unknown>).name === 'string'
        ? String((articleRow.author as Record<string, unknown>).name)
        : null);

  const publishedAt =
    safeDate(
      extractMetaContent(html, 'article:published_time')
      ?? extractMetaContent(html, 'datePublished', 'itemprop')
      ?? (typeof articleRow?.datePublished === 'string' ? articleRow.datePublished : null),
    );

  const modifiedAt =
    safeDate(
      extractMetaContent(html, 'article:modified_time')
      ?? extractMetaContent(html, 'dateModified', 'itemprop')
      ?? (typeof articleRow?.dateModified === 'string' ? articleRow.dateModified : null),
    );

  const paragraphs = extractBodyParagraphs(html);
  const fallbackText = [params.title, params.summary ?? ''].filter(Boolean).join('. ').trim();
  const extractedText = (paragraphs.join(' ') || fallbackText || null)?.slice(0, 12_000) ?? null;
  const sentences = splitSentences(extractedText ?? fallbackText);

  return {
    canonicalUrl,
    sourceDomain,
    author: author?.slice(0, 180) ?? null,
    publishedAt,
    modifiedAt,
    articleTitle: articleTitle?.slice(0, 300) ?? null,
    description: description?.slice(0, 500) ?? null,
    extractedText,
    paragraphs,
    knownFacts: extractKnownFacts(sentences),
    unknowns: inferUnknowns(extractedText ?? fallbackText),
    keyClaims: extractClaims(sentences),
    quotes: extractQuotes(extractedText ?? fallbackText),
    metrics: extractMetrics(sentences),
    timeline: extractTimeline(sentences),
  };
}

export type NewsExtractionBundle = {
  sourceTaxonomy: SourceTaxonomy;
  extraction: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export function buildNewsExtractionBundle(params: {
  html?: string | null;
  url: string;
  title: string;
  summary?: string | null;
  sourceType?: string | null;
}): NewsExtractionBundle {
  const intelligence = extractArticleIntelligence(params);
  const sourceTaxonomy = inferSourceTaxonomy(intelligence.sourceDomain, params.sourceType);

  return {
    sourceTaxonomy,
    extraction: {
      known_facts: intelligence.knownFacts,
      unknowns: intelligence.unknowns,
      key_claims: intelligence.keyClaims,
      quotes: intelligence.quotes,
      metrics: intelligence.metrics,
      timeline: intelligence.timeline,
      extracted_text: intelligence.extractedText,
      paragraphs: intelligence.paragraphs,
      article_title: intelligence.articleTitle,
      article_description: intelligence.description,
      article_author: intelligence.author,
      article_published_at: intelligence.publishedAt,
      article_modified_at: intelligence.modifiedAt,
      canonical_url: intelligence.canonicalUrl,
      source_domain: intelligence.sourceDomain,
    },
    metadata: {
      source_category: sourceTaxonomy.category,
      source_label: sourceTaxonomy.label,
      claim_count: intelligence.keyClaims.length,
      quote_count: intelligence.quotes.length,
      fact_count: intelligence.knownFacts.length,
      extracted_at: new Date().toISOString(),
      extraction_version: 'v2',
    },
  };
}
