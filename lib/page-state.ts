import { buildSchemaBundle } from '@/lib/page-render';
import { runPublishGuards } from '@/lib/publish-guards';
import { NEWSLETTER_URL, PRODUCT_DESTINATION_URL } from '@/lib/brand';
import type { PageRecord, PageReference, ReviewMethodology } from '@/lib/types';

type PageLike = Pick<
  PageRecord,
  | 'id'
  | 'slug'
  | 'template'
  | 'title'
  | 'meta_description'
  | 'h1'
  | 'intro'
  | 'body_json'
  | 'pillar_id'
  | 'primary_keyword'
  | 'secondary_keywords'
  | 'internal_links'
  | 'schema_org'
  | 'metadata'
  | 'status'
  | 'published_at'
  | 'updated_at'
>;

export function buildPagePath(page: Pick<PageRecord, 'template' | 'slug'>) {
  return `/${page.template}/${page.slug}`;
}

function buildDefaultReviewMethodology(page: PageLike): ReviewMethodology | undefined {
  if (!['reviews', 'alternatives', 'guides', 'compatibility'].includes(page.template)) return undefined;

  return {
    summary: 'This page combines hands-on product/category evaluation, pricing context, published specifications, and editorial scoring against athlete use-case fit.',
    tested: [
      'Device or category fit for recovery goals',
      'Feature depth, app quality, and friction points',
      'Battery, comfort, and everyday usability',
    ],
    scoring: [
      'Accuracy and signal usefulness',
      'Ease of setup and long-term adherence',
      'Value for money versus competing options',
    ],
    use_cases: [
      'Athletes tracking recovery load',
      'Buyers comparing wearables and alternatives',
      'Readers balancing signal quality against budget',
    ],
  };
}

function buildFallbackReferences(page: PageLike): PageReference[] {
  const feeds = page.body_json?.info_gain_feeds;
  const out: PageReference[] = [];

  for (const item of feeds?.scientific_alpha?.items ?? []) {
    out.push({
      title: item.title,
      url: item.url,
      source: item.journal ?? 'PubMed',
      year: item.pubdate ?? null,
    });
  }

  for (const snapshot of feeds?.price_performance?.snapshots ?? []) {
    if (!snapshot.url) continue;
    out.push({
      title: `${snapshot.retailer} price snapshot`,
      url: snapshot.url,
      source: snapshot.retailer,
      year: snapshot.captured_at.slice(0, 10),
    });
  }

  return out.slice(0, 8);
}

function buildKeyTakeaways(page: PageLike) {
  const existing = page.body_json?.key_takeaways ?? [];
  if (existing.length > 0) return existing.slice(0, 4);

  const verdict = page.body_json?.verdict ?? [];
  const takeaways = verdict
    .map((item) => item.replace(/^(Best for:|Avoid if:|Bottom line:)\s*/i, '').trim())
    .filter(Boolean)
    .slice(0, 3);

  return takeaways;
}

function withEditorialDefaults(page: PageLike) {
  const conversionGoalByTemplate: Partial<Record<PageLike['template'], string>> = {
    alternatives: 'product_comparison',
    reviews: 'product_validation',
    costs: 'pricing_evaluation',
    compatibility: 'fit_confirmation',
    metrics: 'signal_education',
    pillars: 'cluster_entry',
    guides: 'newsletter_capture',
  };

  return {
    ...(page.metadata ?? {}),
    author_slug: typeof page.metadata?.author_slug === 'string' ? page.metadata.author_slug : 'editorial-team',
    author_name: typeof page.metadata?.author_name === 'string' ? page.metadata.author_name : 'RecoveryStack Editorial Team',
    author_title:
      typeof page.metadata?.author_title === 'string'
        ? page.metadata.author_title
        : 'Sports Science & Recovery Technology Analysts',
    reviewer_slug: typeof page.metadata?.reviewer_slug === 'string' ? page.metadata.reviewer_slug : 'editorial-team',
    reviewer_name: typeof page.metadata?.reviewer_name === 'string' ? page.metadata.reviewer_name : 'RecoveryStack Editorial Team',
    reviewer_title:
      typeof page.metadata?.reviewer_title === 'string'
        ? page.metadata.reviewer_title
        : 'Clinical and Evidence Review',
    reviewed_at:
      typeof page.metadata?.reviewed_at === 'string' ? page.metadata.reviewed_at : new Date().toISOString(),
    hero_image_alt:
      typeof page.metadata?.hero_image_alt === 'string'
        ? page.metadata.hero_image_alt
        : `${page.title} hero image`,
    market_focus:
      typeof page.metadata?.market_focus === 'string'
        ? page.metadata.market_focus
        : 'smart_ring',
    conversion_goal:
      typeof page.metadata?.conversion_goal === 'string'
        ? page.metadata.conversion_goal
        : conversionGoalByTemplate[page.template] ?? 'newsletter_capture',
    conversion_stage:
      typeof page.metadata?.conversion_stage === 'string'
        ? page.metadata.conversion_stage
        : ['alternatives', 'reviews', 'costs', 'compatibility'].includes(page.template)
          ? 'buyer'
          : ['metrics', 'guides', 'pillars'].includes(page.template)
            ? 'consideration'
            : 'awareness',
    newsletter_url:
      typeof page.metadata?.newsletter_url === 'string'
        ? page.metadata.newsletter_url
        : NEWSLETTER_URL,
    product_destination_url:
      typeof page.metadata?.product_destination_url === 'string'
        ? page.metadata.product_destination_url
        : PRODUCT_DESTINATION_URL,
    product_cta_label:
      typeof page.metadata?.product_cta_label === 'string'
        ? page.metadata.product_cta_label
        : ['alternatives', 'reviews', 'costs', 'compatibility'].includes(page.template)
          ? 'See the ring product page'
          : 'Explore the Volo Ring',
  };
}

function buildEnhancedBody(page: PageLike, intro: string, bodyJson: NonNullable<PageRecord['body_json']>) {
  const references = (bodyJson.references?.length ? bodyJson.references : buildFallbackReferences({ ...page, intro, body_json: bodyJson }))
    .filter((item, index, array) => item?.url && array.findIndex((candidate) => candidate.url === item.url) === index)
    .slice(0, 8);

  const methodology = bodyJson.review_methodology ?? buildDefaultReviewMethodology(page);
  const keyTakeaways = buildKeyTakeaways({ ...page, intro, body_json: bodyJson });
  const sections = [...(bodyJson.sections ?? [])];

  if ((page.template === 'protocols' || page.template === 'metrics') && !sections.some((section) => section.id === 'medical-disclaimer')) {
    sections.push({
      id: 'medical-disclaimer',
      heading: 'Medical disclaimer',
      kind: 'paragraphs',
      content: ['This content is educational and not medical advice. If you have a medical condition, symptoms, or medication questions, consult a licensed clinician before changing your recovery routine.'],
    });
  }

  return {
    ...bodyJson,
    sections,
    references,
    key_takeaways: keyTakeaways,
    ...(methodology ? { review_methodology: methodology } : {}),
  };
}

export function buildSchemaOrgForPage(page: PageLike) {
  return buildSchemaBundle(page as PageRecord, buildPagePath(page));
}

export function buildGeneratedPageUpdate(page: PageLike, intro: string, bodyJson: NonNullable<PageRecord['body_json']>) {
  const generatedAt = new Date().toISOString();
  const status = page.status === 'published' ? 'published' : 'approved';
  const metadata = withEditorialDefaults(page);
  const enhancedBody = buildEnhancedBody(page, intro, bodyJson);
  const schemaOrg = buildSchemaOrgForPage({
    ...page,
    intro,
    body_json: enhancedBody,
    schema_org: page.schema_org,
    metadata,
    status,
    updated_at: generatedAt,
  });

  return {
    intro,
    body_json: enhancedBody,
    schema_org: schemaOrg,
    metadata,
    status,
    last_generated_at: generatedAt,
    needs_revalidation: page.status === 'published',
  } as const;
}

export function buildPublishUpdate(page: PageLike, now = new Date().toISOString()) {
  return {
    status: 'published' as const,
    published_at: page.published_at ?? now,
    needs_revalidation: true,
  };
}

export function validatePageForPublish(page: PageLike) {
  const schemaOrg = page.schema_org ?? buildSchemaOrgForPage(page);
  return {
    schemaOrg,
    errors: runPublishGuards({ ...page, schema_org: schemaOrg }),
  };
}
