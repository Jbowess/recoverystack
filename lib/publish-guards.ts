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

function countWord(text: string, word: string): number {
  const regex = new RegExp(`\\b${word}\\b`, 'gi');
  return text.match(regex)?.length ?? 0;
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
  const haystack = collectStrings([page.body_json, page.title, page.intro]).join('\n').toLowerCase();

  const required = ['ring', 'newsletter', 'pdf'] as const;
  for (const keyword of required) {
    const count = countWord(haystack, keyword);
    if (count !== 1) {
      errors.push(`required CTA mention '${keyword}' must appear exactly once (found ${count})`);
    }
  }

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
