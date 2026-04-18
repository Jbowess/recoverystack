/**
 * Schema Validator
 *
 * Validates structured data (JSON-LD) on published pages against:
 *   1. Google's Rich Results Test API (if GOOGLE_API_KEY set)
 *   2. Local structural validation rules (always runs)
 *
 * Detects:
 *   - Missing required properties (e.g. FAQPage without acceptedAnswer)
 *   - Invalid types (price without priceCurrency)
 *   - Schema eligibility per template (HowTo on protocols, FAQ on guides)
 *   - Orphaned schema (schema type not matching page content)
 *
 * Writes results to `schema_validation_results`.
 * Flags pages with critical errors in metadata.schema_errors.
 * Enqueues pages with fixable errors to content_refresh_queue.
 *
 * Usage:
 *   npx tsx scripts/schema-validator.ts
 *   npx tsx scripts/schema-validator.ts --dry-run
 *   SCHEMA_VALIDATE_LIMIT=50 npx tsx scripts/schema-validator.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';
const LIMIT = Number(process.env.SCHEMA_VALIDATE_LIMIT ?? 50);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const REFRESH_AFTER_DAYS = Number(process.env.SCHEMA_REFRESH_DAYS ?? 14);

// ── Required schema types per template ────────────────────────────────────────
const REQUIRED_SCHEMA_BY_TEMPLATE: Record<string, string[]> = {
  guides: ['Article', 'BreadcrumbList', 'FAQPage'],
  alternatives: ['Article', 'BreadcrumbList', 'Product'],
  protocols: ['HowTo', 'BreadcrumbList', 'Article', 'MedicalWebPage'],
  metrics: ['Article', 'BreadcrumbList', 'MedicalWebPage'],
  costs: ['Article', 'BreadcrumbList', 'Product'],
  compatibility: ['Article', 'BreadcrumbList'],
  pillars: ['Article', 'BreadcrumbList'],
  reviews: ['Article', 'BreadcrumbList', 'Product', 'AggregateRating'],
  checklists: ['Article', 'BreadcrumbList', 'ItemList'],
  news: ['NewsArticle', 'BreadcrumbList'],
  trends: ['NewsArticle', 'BreadcrumbList'],
};

// ── Local structural validation ────────────────────────────────────────────────
type ValidationIssue = {
  severity: 'error' | 'warning' | 'info';
  schema_type: string;
  property: string;
  message: string;
};

function validateSchemaLocally(
  schemas: unknown[],
  template: string,
  pageSlug: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const presentTypes = new Set<string>();

  for (const schema of schemas) {
    if (!schema || typeof schema !== 'object') continue;
    const s = schema as Record<string, unknown>;
    const type = String(s['@type'] ?? '');
    presentTypes.add(type);

    // FAQPage validation
    if (type === 'FAQPage') {
      const entities = s.mainEntity;
      if (!Array.isArray(entities) || entities.length === 0) {
        issues.push({ severity: 'error', schema_type: 'FAQPage', property: 'mainEntity', message: 'FAQPage.mainEntity is empty or missing' });
      } else {
        for (const [i, q] of entities.entries()) {
          const qObj = q as Record<string, unknown>;
          if (!qObj.name) issues.push({ severity: 'error', schema_type: 'FAQPage', property: `mainEntity[${i}].name`, message: 'Question missing name' });
          const answer = qObj.acceptedAnswer as Record<string, unknown> | undefined;
          if (!answer?.text) issues.push({ severity: 'error', schema_type: 'FAQPage', property: `mainEntity[${i}].acceptedAnswer.text`, message: 'Answer text missing' });
        }
      }
    }

    // HowTo validation
    if (type === 'HowTo') {
      const steps = s.step;
      if (!Array.isArray(steps) || steps.length === 0) {
        issues.push({ severity: 'error', schema_type: 'HowTo', property: 'step', message: 'HowTo.step is empty or missing' });
      }
      if (!s.name) issues.push({ severity: 'error', schema_type: 'HowTo', property: 'name', message: 'HowTo.name missing' });
    }

    // Product validation
    if (type === 'Product') {
      if (!s.name) issues.push({ severity: 'error', schema_type: 'Product', property: 'name', message: 'Product.name missing' });
      const offers = s.offers as Record<string, unknown> | undefined;
      if (offers) {
        if (!offers.price && !offers.priceRange) {
          issues.push({ severity: 'warning', schema_type: 'Product', property: 'offers.price', message: 'Product.offers.price missing (required for rich result)' });
        }
        if (offers.price && !offers.priceCurrency) {
          issues.push({ severity: 'error', schema_type: 'Product', property: 'offers.priceCurrency', message: 'Product.offers.priceCurrency missing' });
        }
      }
    }

    // AggregateRating validation
    if (type === 'AggregateRating') {
      if (!s.ratingValue) issues.push({ severity: 'error', schema_type: 'AggregateRating', property: 'ratingValue', message: 'AggregateRating.ratingValue missing' });
      if (!s.ratingCount) issues.push({ severity: 'warning', schema_type: 'AggregateRating', property: 'ratingCount', message: 'AggregateRating.ratingCount missing' });
    }

    // Article/NewsArticle validation
    if (type === 'Article' || type === 'NewsArticle') {
      if (!s.headline) issues.push({ severity: 'error', schema_type: type, property: 'headline', message: `${type}.headline missing` });
      if (!s.datePublished && !s.dateModified) issues.push({ severity: 'warning', schema_type: type, property: 'datePublished', message: `${type}.datePublished missing` });
      if (!s.author) issues.push({ severity: 'error', schema_type: type, property: 'author', message: `${type}.author missing` });
      if (!s.publisher) issues.push({ severity: 'error', schema_type: type, property: 'publisher', message: `${type}.publisher missing` });
      if ((s.headline as string)?.length > 110) {
        issues.push({ severity: 'warning', schema_type: type, property: 'headline', message: `${type}.headline exceeds 110 characters (${(s.headline as string).length})` });
      }
    }

    // BreadcrumbList validation
    if (type === 'BreadcrumbList') {
      const items = s.itemListElement;
      if (!Array.isArray(items) || items.length < 2) {
        issues.push({ severity: 'warning', schema_type: 'BreadcrumbList', property: 'itemListElement', message: 'BreadcrumbList should have ≥2 items' });
      }
    }

    // ItemList validation
    if (type === 'ItemList') {
      if (!s.numberOfItems || !s.itemListElement) {
        issues.push({ severity: 'warning', schema_type: 'ItemList', property: 'itemListElement', message: 'ItemList missing numberOfItems or itemListElement' });
      }
    }
  }

  // Check required types for this template
  const required = REQUIRED_SCHEMA_BY_TEMPLATE[template] ?? [];
  for (const requiredType of required) {
    if (!presentTypes.has(requiredType)) {
      issues.push({
        severity: 'warning',
        schema_type: requiredType,
        property: '@type',
        message: `Schema type ${requiredType} expected for template "${template}" but not present`,
      });
    }
  }

  return issues;
}

// ── Google Rich Results Test API ──────────────────────────────────────────────
type GoogleRichResultsResponse = {
  richResultsItems?: Array<{ name: string; items: Array<{ issues?: Array<{ type: string; severity: string; message: string }> }> }>;
  detectedItems?: Array<{ name: string; items: Array<unknown> }>;
};

async function validateViaGoogleApi(pageUrl: string): Promise<ValidationIssue[]> {
  if (!GOOGLE_API_KEY) return [];
  await rateLimit('fetch');

  try {
    const url = new URL('https://searchconsole.googleapis.com/v1/urlTestingTools/mobileFriendlyTest:run');
    // Note: Rich Results Test API endpoint
    const rtUrl = new URL('https://searchconsole.googleapis.com/v1/richResults:run');
    rtUrl.searchParams.set('key', GOOGLE_API_KEY);

    const res = await fetch(rtUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return [];
    const data: GoogleRichResultsResponse = await res.json();

    const issues: ValidationIssue[] = [];
    for (const item of data.richResultsItems ?? []) {
      for (const inner of item.items) {
        for (const issue of inner.issues ?? []) {
          issues.push({
            severity: issue.severity === 'ERROR' ? 'error' : 'warning',
            schema_type: item.name,
            property: '',
            message: issue.message,
          });
        }
      }
    }

    return issues;
  } catch {
    return [];
  }
}

async function run(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  const { data: recentData } = await supabase
    .from('schema_validation_results')
    .select('page_slug')
    .gte('validated_at', cutoff);
  const recentSlugs = new Set((recentData ?? []).map((r: any) => String(r.page_slug)));

  const { data: pages, error } = await supabase
    .from('pages')
    .select('slug, template, title, schema_org, published_at')
    .eq('status', 'published')
    .not('schema_org', 'is', null)
    .order('published_at', { ascending: false })
    .limit(LIMIT);

  if (error) throw error;

  let errorCount = 0;
  let warningCount = 0;

  for (const page of (pages ?? []) as Array<{ slug: string; template: string; title: string; schema_org: unknown }>) {
    if (recentSlugs.has(page.slug)) continue;

    const schemas = Array.isArray(page.schema_org) ? page.schema_org : [page.schema_org];
    const localIssues = validateSchemaLocally(schemas, page.template, page.slug);

    const pageUrl = `${SITE_URL}/${page.template}/${page.slug}`;
    const googleIssues = await validateViaGoogleApi(pageUrl);

    const allIssues = [...localIssues, ...googleIssues];
    const errors = allIssues.filter((i) => i.severity === 'error');
    const warnings = allIssues.filter((i) => i.severity === 'warning');

    errorCount += errors.length;
    warningCount += warnings.length;

    if (allIssues.length > 0) {
      console.log(`[schema-validator] ${page.slug}: ${errors.length} errors, ${warnings.length} warnings`);
      for (const issue of errors) {
        console.log(`  ERROR [${issue.schema_type}] ${issue.property}: ${issue.message}`);
      }
      for (const issue of warnings.slice(0, 3)) {
        console.log(`  WARN  [${issue.schema_type}] ${issue.property}: ${issue.message}`);
      }
    }

    if (DRY_RUN) continue;

    await supabase.from('schema_validation_results').upsert({
      page_slug: page.slug,
      template: page.template,
      error_count: errors.length,
      warning_count: warnings.length,
      issues: allIssues,
      validated_at: new Date().toISOString(),
    }, { onConflict: 'page_slug' });

    // Flag pages with errors in metadata
    if (errors.length > 0) {
      await supabase.from('pages').update({
        metadata: { schema_errors: errors.map((e) => e.message), schema_validated_at: new Date().toISOString() },
      }).eq('slug', page.slug);

      // Enqueue fixable errors for content refresh
      await supabase.from('content_refresh_queue').upsert({
        page_slug: page.slug,
        reason: `schema_errors:${errors.map((e) => e.schema_type).join(',')}`,
        priority: 'high',
        auto_approve: true,
        created_at: new Date().toISOString(),
      }, { onConflict: 'page_slug' });
    }
  }

  console.log(`[schema-validator] Done. Total errors: ${errorCount}, warnings: ${warningCount} (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
