import { z } from 'zod';

type QualityPageInput = {
  body_json: unknown;
  schema_org: unknown;
  internal_links?: unknown;
  template?: string | null;
  title?: string | null;
  intro?: string | null;
};

const bannedPhrases = [
  'groundbreaking',
  'game-changer',
  'unleash',
  'revolutionary',
  "in today's fast-paced world",
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
  if (page.template === 'pillars') return [];

  const errors: string[] = [];
  const parsedLinks = z.array(InternalLinkSchema).safeParse(page.internal_links ?? []);

  if (!parsedLinks.success) {
    return ['internal_links must be a valid array'];
  }

  const links = parsedLinks.data;
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
  ];

  const banned = lintBannedPhrases([page.body_json, page.title, page.intro]);
  if (banned.length) {
    errors.push(`banned phrases found: ${banned.join(', ')}`);
  }

  return errors;
}
