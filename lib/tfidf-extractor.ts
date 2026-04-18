/**
 * TF-IDF Entity Extractor
 *
 * Fetches and NLP-processes competitor pages to identify:
 *   1. Terms that appear consistently across ALL top-ranking pages (required entities)
 *   2. Terms that appear only in high-ranking pages but not lower-ranking ones (differentiating)
 *   3. TF-IDF scored term frequency distribution
 *
 * This is the core of semantic SEO — telling the content generator which
 * entities and phrases MUST appear for Google to consider the page topically complete.
 *
 * Used by: scripts/competitor-content-extractor.ts, scripts/brief-generator.ts
 */

export type TfidfResult = {
  /** Terms that appear in ≥ 60% of top-ranking pages — semantically required */
  requiredEntities: string[];
  /** Terms that appear in top 3 but not in positions 4-10 — differentiating signals */
  differentiatingEntities: string[];
  /** Top 30 terms with TF-IDF scores, sorted descending */
  topTerms: Array<{ term: string; score: number; docFreq: number }>;
  /** Raw term → IDF map */
  idfMap: Record<string, number>;
};

export type PageTermData = {
  url: string;
  position: number;
  terms: Map<string, number>;  // term → term frequency (normalised)
  wordCount: number;
};

// Recovery/fitness domain stop words (extend standard list)
const DOMAIN_STOP_WORDS = new Set([
  // Standard stop words
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'do', 'does',
  'for', 'from', 'get', 'got', 'had', 'has', 'have', 'he', 'her', 'here', 'him',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'know', 'let',
  'like', 'me', 'more', 'my', 'not', 'of', 'on', 'one', 'or', 'our', 'out', 'own',
  'page', 'she', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'up',
  'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'will', 'with', 'would', 'you', 'your',
  // Generic web/content noise
  'click', 'read', 'share', 'follow', 'subscribe', 'cookie', 'privacy', 'policy',
  'terms', 'copyright', 'rights', 'reserved', 'navigation', 'menu', 'footer',
  'header', 'sidebar', 'advertisement', 'sponsored', 'loading', 'skip', 'jump',
  'back', 'next', 'previous', 'home', 'about', 'contact', 'search',
  // Common but semantically weak fitness terms
  'also', 'many', 'much', 'even', 'still', 'well', 'good', 'great', 'best',
  'important', 'different', 'new', 'other', 'first', 'last', 'only', 'same',
  'need', 'want', 'help', 'make', 'take', 'use', 'using', 'used', 'way', 'work',
  'works', 'working', 'thing', 'things', 'time', 'times', 'day', 'days',
  'week', 'weeks', 'month', 'months', 'year', 'years', 'people', 'person',
  'body', 'health', 'healthy',
]);

// Minimum term length to consider
const MIN_TERM_LENGTH = 3;
// Maximum ngram size
const MAX_NGRAM = 3;
// Minimum document frequency for a term to be considered (appears in at least this many pages)
const MIN_DOC_FREQ = 2;

/**
 * Tokenize text into unigrams, bigrams, and trigrams.
 * Preserves important domain bigrams like "heart rate", "HRV training", etc.
 */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned
    .split(' ')
    .filter((w) => w.length >= MIN_TERM_LENGTH && !DOMAIN_STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const tokens: string[] = [...words];

  // Add bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length > 5) tokens.push(bigram);
  }

  // Add trigrams for known high-value patterns
  for (let i = 0; i < words.length - 2; i++) {
    const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (trigram.length > 8) tokens.push(trigram);
  }

  return tokens;
}

/**
 * Compute term frequency (normalised by document length) for a page's text.
 */
export function computeTermFrequency(text: string): Map<string, number> {
  const tokens = tokenize(text);
  const freq = new Map<string, number>();

  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  // Normalise by total token count
  const total = tokens.length || 1;
  for (const [term, count] of freq.entries()) {
    freq.set(term, count / total);
  }

  return freq;
}

/**
 * Extract meaningful text from HTML — strips scripts, styles, nav, footer.
 * Returns heading text separately for boosted weighting.
 */
export function extractTextFromHtml(html: string): { bodyText: string; headingText: string; metaText: string } {
  // Strip non-content elements
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Extract heading text (boosted)
  const headingMatches = cleaned.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi) ?? [];
  const headingText = headingMatches
    .map((h) => h.replace(/<[^>]+>/g, ' ').trim())
    .join(' ');

  // Extract meta title + description
  const metaTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const metaText = [
    metaTitleMatch?.[1] ?? '',
    metaDescMatch?.[1] ?? '',
  ].join(' ');

  // Body text
  const bodyText = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return { bodyText, headingText, metaText };
}

/**
 * Extract heading structure from HTML.
 */
export function extractHeadings(html: string): { level: number; text: string }[] {
  const matches = html.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi) ?? [];
  return matches.map((h) => {
    const levelMatch = h.match(/^<h([1-6])/i);
    const level = levelMatch ? parseInt(levelMatch[1]) : 2;
    const text = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { level, text };
  });
}

/**
 * Extract JSON-LD schema types from HTML.
 */
export function extractSchemaTypes(html: string): string[] {
  const types: string[] = [];
  const scriptMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];

  for (const script of scriptMatches) {
    try {
      const json = script.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
      const parsed = JSON.parse(json);
      const schemas = Array.isArray(parsed) ? parsed : [parsed];
      for (const schema of schemas) {
        if (schema?.['@type']) {
          const t = schema['@type'];
          if (Array.isArray(t)) types.push(...t);
          else types.push(String(t));
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  return [...new Set(types)];
}

/**
 * Compute IDF (Inverse Document Frequency) across a corpus of pages.
 * IDF = log(N / df) where N = total docs, df = docs containing the term.
 */
function computeIdf(pageTerms: Map<string, number>[], allTerms: Set<string>): Map<string, number> {
  const N = pageTerms.length;
  const idf = new Map<string, number>();

  for (const term of allTerms) {
    const df = pageTerms.filter((pt) => pt.has(term)).length;
    if (df === 0) continue;
    // Smoothed IDF
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }

  return idf;
}

/**
 * Main TF-IDF analysis.
 *
 * @param pages Array of {url, position, html} for top SERP pages
 * @param topNPositions Only treat pages in these positions as "top" for required entity detection
 */
export function computeTfidf(
  pages: Array<{ url: string; position: number; html: string }>,
  topNPositions = 3,
): TfidfResult {
  if (pages.length === 0) {
    return { requiredEntities: [], differentiatingEntities: [], topTerms: [], idfMap: {} };
  }

  // Parse each page
  const pageTermData: PageTermData[] = pages.map((p) => {
    const { bodyText, headingText, metaText } = extractTextFromHtml(p.html);

    // Boost headings 3x and meta 2x by repeating them in the text
    const weightedText = [
      bodyText,
      headingText, headingText, headingText,  // 3x boost
      metaText, metaText,                      // 2x boost
    ].join(' ');

    const terms = computeTermFrequency(weightedText);
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    return { url: p.url, position: p.position, terms, wordCount };
  });

  // Collect all unique terms
  const allTerms = new Set<string>();
  for (const { terms } of pageTermData) {
    for (const term of terms.keys()) allTerms.add(term);
  }

  // Compute IDF
  const idfMap = computeIdf(
    pageTermData.map((p) => p.terms),
    allTerms,
  );

  // Compute TF-IDF scores per page
  const pageTfidf: Map<string, Map<string, number>> = new Map();
  for (const pd of pageTermData) {
    const scores = new Map<string, number>();
    for (const [term, tf] of pd.terms.entries()) {
      const idf = idfMap.get(term) ?? 0;
      scores.set(term, tf * idf);
    }
    pageTfidf.set(pd.url, scores);
  }

  // Aggregate: mean TF-IDF score across all pages, plus document frequency
  const termStats = new Map<string, { totalScore: number; docFreq: number }>();
  for (const scores of pageTfidf.values()) {
    for (const [term, score] of scores.entries()) {
      const existing = termStats.get(term) ?? { totalScore: 0, docFreq: 0 };
      termStats.set(term, {
        totalScore: existing.totalScore + score,
        docFreq: existing.docFreq + 1,
      });
    }
  }

  // Filter: must appear in at least MIN_DOC_FREQ pages
  const qualified = Array.from(termStats.entries())
    .filter(([, stats]) => stats.docFreq >= MIN_DOC_FREQ)
    .map(([term, stats]) => ({
      term,
      score: stats.totalScore / pages.length,
      docFreq: stats.docFreq,
    }))
    .sort((a, b) => b.score - a.score);

  const topTerms = qualified.slice(0, 30);

  // Required entities: appear in ≥60% of all pages
  const requiredThreshold = Math.ceil(pages.length * 0.6);
  const requiredEntities = qualified
    .filter((t) => t.docFreq >= requiredThreshold)
    .map((t) => t.term)
    .slice(0, 25);

  // Differentiating entities: appear in top-3 pages but NOT in lower-ranked pages
  const topPages = pageTermData.filter((p) => p.position <= topNPositions);
  const lowerPages = pageTermData.filter((p) => p.position > topNPositions);

  const topTermSet = new Set<string>();
  for (const pd of topPages) {
    for (const term of pd.terms.keys()) topTermSet.add(term);
  }

  const lowerTermSet = new Set<string>();
  for (const pd of lowerPages) {
    for (const term of pd.terms.keys()) lowerTermSet.add(term);
  }

  const differentiatingEntities = Array.from(topTermSet)
    .filter((t) => !lowerTermSet.has(t) && !DOMAIN_STOP_WORDS.has(t) && t.length >= MIN_TERM_LENGTH)
    .filter((t) => {
      // Must have meaningful TF-IDF score in top pages
      const stats = termStats.get(t);
      return stats && stats.totalScore > 0.001;
    })
    .slice(0, 15);

  const idfObj: Record<string, number> = {};
  for (const [term, score] of idfMap.entries()) {
    idfObj[term] = score;
  }

  return {
    requiredEntities,
    differentiatingEntities,
    topTerms,
    idfMap: idfObj,
  };
}
