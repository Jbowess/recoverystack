import { z } from 'zod';

type QualityPageInput = {
  body_json: unknown;
  schema_org: unknown;
  internal_links?: unknown;
  template?: string | null;
  title?: string | null;
  intro?: string | null;
  meta_description?: string | null;
};

const bannedPhrases = [
  'groundbreaking',
  'game-changer',
  'unleash',
  'revolutionary',
  "in today's fast-paced world",
  'dive into',
  'dive deep',
  'look no further',
  'without further ado',
  'in this article we will',
  'are you looking for',
  'buckle up',
] as const;

const genericAnchors = ['click here', 'read more', 'learn more', 'this article', 'here'];

const BodySchema = z.object({
  comparison_table: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .optional(),
  verdict: z.array(z.string()).min(2).max(3),
  sections: z.array(
    z.object({
      id: z.string(),
      heading: z.string(),
      kind: z.enum(['paragraphs', 'faq', 'steps', 'list', 'table']),
      content: z.unknown(),
    }),
  ),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
});

const SchemaOrgItemSchema = z.object({
  '@context': z.string().optional(),
  '@type': z.string().optional(),
});

const SchemaOrgSchema = z.union([SchemaOrgItemSchema, z.array(SchemaOrgItemSchema)]);

const InternalLinkSchema = z.object({
  slug: z.string().min(1),
  anchor: z.string().min(1),
  template: z.string().optional(),
});

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

function normalizeForCtaCounting(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\/[a-z0-9\-_/]+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase();
}

function countWord(text: string, word: string): number {
  // Context-aware matching for CTA keywords
  if (word === 'ring') {
    // Match "ring" in product context, not as standalone word in other contexts
    // Accept: "smart ring", "recoverystack ring", "the ring", "our ring", "a ring"
    // Reject: "ring finger", "boxing ring", "ring tone"
    const productPattern = /\b(?:smart\s+ring|recoverystack\s+(?:smart\s+)?ring|the\s+ring|our\s+ring|a\s+ring)\b/gi;
    const standalone = /\bring\b/gi;
    const productMatches = text.match(productPattern)?.length ?? 0;
    // If product-context matches exist, use those; otherwise fall back to standalone
    if (productMatches > 0) return productMatches;
    return text.match(standalone)?.length ?? 0;
  }
  const regex = new RegExp(`\\b${word}\\b`, 'gi');
  return text.match(regex)?.length ?? 0;
}

export function countRequiredCtaMentions(page: Pick<QualityPageInput, 'body_json' | 'title' | 'intro'>): Record<'ring' | 'newsletter' | 'pdf', number> {
  const raw = collectStrings([page.body_json, page.title, page.intro]).join('\n');
  const haystack = normalizeForCtaCounting(raw);

  return {
    ring: countWord(haystack, 'ring'),
    newsletter: countWord(haystack, 'newsletter'),
    pdf: countWord(haystack, 'pdf'),
  };
}

function isDescriptiveAnchor(anchor: string): boolean {
  const normalized = anchor.trim().toLowerCase();
  if (!normalized || genericAnchors.includes(normalized)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 2;
}

export function lintBannedPhrases(value: unknown): string[] {
  const lowerHaystack = collectStrings(value).join('\n').toLowerCase();
  return bannedPhrases.filter((phrase) => lowerHaystack.includes(phrase.toLowerCase()));
}

export function validatePublishSchemas(page: Pick<QualityPageInput, 'body_json' | 'schema_org'>): string[] {
  const errors: string[] = [];

  const body = BodySchema.safeParse(page.body_json);
  if (!body.success) {
    errors.push('body_json failed schema validation');
  }

  if (page.schema_org == null) {
    errors.push('schema_org is required');
  } else {
    const schemaOrg = SchemaOrgSchema.safeParse(page.schema_org);
    if (!schemaOrg.success) {
      errors.push('schema_org must be an object or array of objects');
    }
  }

  return errors;
}

export function validateRequiredCtas(page: QualityPageInput): string[] {
  const errors: string[] = [];
  const counts = countRequiredCtaMentions(page);

  (Object.keys(counts) as Array<keyof typeof counts>).forEach((keyword) => {
    const count = counts[keyword];
    if (count !== 1) {
      errors.push(`required CTA mention '${keyword}' must appear exactly once (found ${count})`);
    }
  });

  return errors;
}

export function validateInternalLinks(page: QualityPageInput): string[] {
  const errors: string[] = [];
  const parsedLinks = z.array(InternalLinkSchema).safeParse(page.internal_links ?? []);

  if (!parsedLinks.success) {
    return ['internal_links must be a valid array'];
  }

  const links = parsedLinks.data;

  // Pillar pages: must link down to at least 5 child pages (no up-link required)
  if (page.template === 'pillars') {
    const childLinks = links.filter((link) => (link.template ?? '').toLowerCase() !== 'pillars');
    if (childLinks.length < 5) {
      errors.push(`pillar internal_links must include at least 5 child-page links (found ${childLinks.length})`);
    }
    const nonDescriptive = links.filter((link) => !isDescriptiveAnchor(link.anchor)).map((link) => link.anchor);
    if (nonDescriptive.length) {
      errors.push(`internal_links contain non-descriptive anchors: ${nonDescriptive.join(', ')}`);
    }
    return errors;
  }

  const upLinks = links.filter((link) => (link.template ?? '').toLowerCase() === 'pillars');
  const siblingLinks = links.filter((link) => (link.template ?? '').toLowerCase() !== 'pillars');

  if (upLinks.length !== 1) {
    errors.push(`internal_links must include exactly 1 pillar up-link (found ${upLinks.length})`);
  }

  if (siblingLinks.length < 3 || siblingLinks.length > 5) {
    errors.push(`internal_links must include 3-5 sibling links (found ${siblingLinks.length})`);
  }

  const nonDescriptive = links.filter((link) => !isDescriptiveAnchor(link.anchor)).map((link) => link.anchor);
  if (nonDescriptive.length) {
    errors.push(`internal_links contain non-descriptive anchors: ${nonDescriptive.join(', ')}`);
  }

  return errors;
}

export function runPublishGuards(page: QualityPageInput): string[] {
  const errors = [
    ...validatePublishSchemas(page),
    ...validateRequiredCtas(page),
    ...validateInternalLinks(page),
    ...validateContentDepth(page),
    ...validateTitleAndMeta(page),
    ...validateEeatSignals(page),
  ];

  const banned = lintBannedPhrases([page.body_json, page.title, page.intro]);
  if (banned.length) {
    errors.push(`banned phrases found: ${banned.join(', ')}`);
  }

  return errors;
}

// ── Content depth checks ──

const MIN_BODY_WORDS: Record<string, number> = {
  pillars: 1200,
  guides: 800,
  alternatives: 700,
  protocols: 600,
  metrics: 500,
  costs: 500,
  compatibility: 500,
  trends: 400,
};

const DEFAULT_MIN_WORDS = 400;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Flesch Reading Ease approximation.
 * 60-70 = standard; below 30 = very difficult; above 80 = easy.
 * SEO target: 45-75 (accessible but not dumbed down).
 */
function fleschReadingEase(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const syllables = words.reduce((sum, word) => sum + estimateSyllables(word), 0);

  if (sentences.length === 0 || words.length === 0) return 0;

  const avgSentenceLength = words.length / sentences.length;
  const avgSyllablesPerWord = syllables / words.length;

  return 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord;
}

function estimateSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  let count = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g)?.length ?? 0;
  return Math.max(1, count);
}

export function validateContentDepth(page: QualityPageInput): string[] {
  const errors: string[] = [];
  const allText = collectStrings([page.body_json, page.intro]).join(' ');
  const wordCount = countWords(allText);
  const template = page.template ?? '';
  const minWords = MIN_BODY_WORDS[template] ?? DEFAULT_MIN_WORDS;

  if (wordCount < minWords) {
    errors.push(`content too thin: ${wordCount} words (minimum ${minWords} for ${template || 'default'})`);
  }

  // Check section count
  const sections = (page.body_json as any)?.sections;
  if (Array.isArray(sections) && sections.length < 3) {
    errors.push(`too few sections: ${sections.length} (minimum 3)`);
  }

  // Readability check
  if (wordCount > 100) {
    const score = fleschReadingEase(allText);
    if (score < 25) {
      errors.push(`readability too difficult: Flesch score ${score.toFixed(0)} (minimum 25)`);
    }
    if (score > 85) {
      errors.push(`readability too simplistic: Flesch score ${score.toFixed(0)} (maximum 85)`);
    }
  }

  return errors;
}

// ── Title & meta description validation ──

export function validateTitleAndMeta(page: QualityPageInput): string[] {
  const errors: string[] = [];

  if (page.title) {
    const titleLen = page.title.length;
    if (titleLen > 60) {
      errors.push(`title too long: ${titleLen} chars (max 60, Google truncates beyond this)`);
    }
    if (titleLen < 20) {
      errors.push(`title too short: ${titleLen} chars (min 20)`);
    }
  } else {
    errors.push('title is required');
  }

  if (page.meta_description) {
    const metaLen = page.meta_description.length;
    if (metaLen > 160) {
      errors.push(`meta_description too long: ${metaLen} chars (max 160)`);
    }
    if (metaLen < 50) {
      errors.push(`meta_description too short: ${metaLen} chars (min 50)`);
    }
  }

  return errors;
}

// ── E-E-A-T signal validation ──

const CITATION_PATTERNS = [
  /\b\d{4}\b/,                           // Year reference (e.g. "2024")
  /et\s+al\.?/i,                         // "et al."
  /\b(?:study|research|findings|journal|published|according to)\b/i,
  /\b(?:ACSM|WHO|FDA|NIH|NSCA|ESC)\b/,  // Named authorities
  /\b(?:peer[- ]reviewed|meta[- ]analysis|clinical trial|randomized)\b/i,
];

export function validateEeatSignals(page: QualityPageInput): string[] {
  const errors: string[] = [];
  const allText = collectStrings([page.body_json]).join(' ');

  // Check for at least one citation-like pattern
  const hasCitation = CITATION_PATTERNS.some((pattern) => pattern.test(allText));
  if (!hasCitation) {
    errors.push('E-E-A-T: no citation or authority reference found in content (expected year, study reference, or named authority)');
  }

  // For protocols/metrics, check for disclaimer
  if (page.template === 'protocols' || page.template === 'metrics') {
    const hasDisclaimer = /\b(?:disclaimer|not\s+medical\s+advice|consult\s+(?:a\s+)?(?:doctor|physician|professional))\b/i.test(allText);
    if (!hasDisclaimer) {
      errors.push(`E-E-A-T: ${page.template} template requires a medical disclaimer`);
    }
  }

  return errors;
}
