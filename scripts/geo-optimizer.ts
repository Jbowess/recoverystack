/**
 * GEO Optimizer — Generative Engine Optimization
 *
 * Restructures published pages so they get cited inside AI-powered answers:
 *   Google AI Overviews, ChatGPT browsing, Perplexity, Bing Copilot.
 *
 * What AI tools cite:
 *   1. Pages that open with a direct 40–60 word answer to the target question
 *   2. "Best for [use case]" framing in H2 position
 *   3. Structured lists with specific, attributable claims
 *   4. speakable schema markup pointing to the direct-answer block
 *
 * Actions taken per page:
 *   - Injects/rewrites a 'geo_answer' section as the FIRST body section
 *   - Adds speakable schema block to schema_org array
 *   - Adds HowTo hasPart or ItemList schema where appropriate
 *   - Records optimisation in geo_optimizations table
 *   - Flags page for ISR revalidation
 *
 * Detection: pulls keywords where serp_features.has_ai_overview = true.
 * Falls back to pages in top 5 with high quality_score when AI overview
 * detection is unavailable (most SERP APIs don't expose AI overview data yet).
 *
 * Usage:
 *   npx tsx scripts/geo-optimizer.ts
 *   npx tsx scripts/geo-optimizer.ts --dry-run
 *   GEO_LIMIT=30 npx tsx scripts/geo-optimizer.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.GEO_LIMIT ?? 15);
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

// Min quality score to target — only optimise pages already worth ranking
const MIN_QUALITY = Number(process.env.GEO_MIN_QUALITY ?? 65);
// Max position to target — top 15 only, these are realistic AI overview candidates
const MAX_POSITION = Number(process.env.GEO_MAX_POSITION ?? 15);

type BodySection = {
  id?: string;
  kind?: string;
  heading?: string;
  content?: unknown;
};

type PageRow = {
  slug: string;
  template: string;
  title: string;
  meta_description: string;
  primary_keyword: string | null;
  body_json: { sections?: BodySection[]; faqs?: Array<{ q: string; a: string }> } | null;
  schema_org: unknown[] | null;
  quality_score: number | null;
  metadata: Record<string, unknown> | null;
};

// ── GEO answer block generation ───────────────────────────────────────────────
async function generateGeoAnswer(
  keyword: string,
  pageTitle: string,
  template: string,
  paaQuestions: string[],
  existingIntro: string,
): Promise<{ direct_answer: string; best_for: string; key_facts: string[] } | null> {
  const prompt = `You are an SEO specialist writing content to be cited in Google AI Overviews.

Keyword: "${keyword}"
Page: "${pageTitle}" (${template} template)
Existing intro: ${existingIntro.slice(0, 300)}

Top questions users ask:
${paaQuestions.slice(0, 3).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Write three things:

1. direct_answer: A 40–60 word direct answer to "${keyword}". Must start with the keyword or "The best..." or "For [use case]...". Include ONE specific number or fact. No fluff, no preamble.

2. best_for: A single sentence starting "Best for:" that names the specific user this page serves (e.g. "Best for: athletes who track HRV daily and want a subscription-free ring").

3. key_facts: 3–4 bullet-point facts about "${keyword}" that are specific, attributable, and include numbers where possible. Each under 20 words.

Return JSON only:
{
  "direct_answer": "string",
  "best_for": "string",
  "key_facts": ["string", "string", "string"]
}`;

  try {
    if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 400,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      return content ? JSON.parse(content) : null;
    }

    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.3, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response ? JSON.parse(data.response) : null;
  } catch {
    return null;
  }
}

// ── Extract plain text from first body section ────────────────────────────────
function extractIntroText(bodyJson: PageRow['body_json']): string {
  if (!bodyJson?.sections?.length) return '';
  const first = bodyJson.sections[0];
  if (typeof first.content === 'string') return first.content;
  if (Array.isArray(first.content)) return (first.content as string[]).filter((s) => typeof s === 'string').join(' ');
  return '';
}

// ── Build speakable schema block ──────────────────────────────────────────────
function buildSpeakableSchema(pageUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['[data-geo-answer]', 'h1', '.meta-description'],
    },
    url: pageUrl,
  };
}

// ── Build ItemList schema for key facts ───────────────────────────────────────
function buildItemListSchema(keyword: string, facts: string[], pageUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Key facts: ${keyword}`,
    url: pageUrl,
    numberOfItems: facts.length,
    itemListElement: facts.map((fact, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: fact,
    })),
  };
}

// ── Build the geo_answer body section ─────────────────────────────────────────
function buildGeoAnswerSection(
  keyword: string,
  answer: { direct_answer: string; best_for: string; key_facts: string[] },
): BodySection {
  return {
    id: 'geo-answer',
    kind: 'geo_answer',
    heading: keyword.charAt(0).toUpperCase() + keyword.slice(1),
    content: {
      direct_answer: answer.direct_answer,
      best_for: answer.best_for,
      key_facts: answer.key_facts,
    },
  };
}

// ── Process one page ──────────────────────────────────────────────────────────
async function processPage(
  page: PageRow,
  paaQuestions: string[],
): Promise<void> {
  const keyword = page.primary_keyword ?? page.title;
  const pageUrl = `${SITE_URL}/${page.template}/${page.slug}`;

  // Skip if already GEO-optimised
  const existingSections = page.body_json?.sections ?? [];
  if (existingSections.some((s) => s.kind === 'geo_answer')) {
    console.log(`[geo] ${page.slug}: already optimised`);
    return;
  }

  const introText = extractIntroText(page.body_json);

  console.log(`[geo] Generating answer block for "${keyword}"...`);
  const answer = await generateGeoAnswer(
    keyword,
    page.title,
    page.template,
    paaQuestions,
    introText,
  );

  if (!answer) {
    console.warn(`[geo] ${page.slug}: failed to generate answer`);
    return;
  }

  console.log(`[geo] ${page.slug}: "${answer.direct_answer.slice(0, 60)}..."`);

  if (DRY_RUN) return;

  // Inject geo_answer section as FIRST section
  const geoSection = buildGeoAnswerSection(keyword, answer);
  const updatedSections = [geoSection, ...existingSections.filter((s) => s.kind !== 'geo_answer')];
  const updatedBodyJson = { ...(page.body_json ?? {}), sections: updatedSections };

  // Build speakable + ItemList schema
  const speakable = buildSpeakableSchema(pageUrl);
  const itemList = buildItemListSchema(keyword, answer.key_facts, pageUrl);
  const currentSchema = Array.isArray(page.schema_org) ? page.schema_org : [page.schema_org].filter(Boolean);

  // Remove stale speakable/ItemList before adding fresh ones
  const filteredSchema = (currentSchema as Array<Record<string, unknown>>).filter(
    (s) => s['@type'] !== 'WebPage' && s['@type'] !== 'ItemList',
  );
  const updatedSchema = [...filteredSchema, speakable, itemList];

  await supabase.from('pages').update({
    body_json: updatedBodyJson,
    schema_org: updatedSchema,
    needs_revalidation: true,
  }).eq('slug', page.slug);

  // Record optimisation
  await supabase.from('geo_optimizations').upsert({
    page_slug: page.slug,
    keyword,
    direct_answer: answer.direct_answer,
    best_for: answer.best_for,
    key_facts: answer.key_facts,
    has_speakable_schema: true,
    has_item_list_schema: true,
    optimized_at: new Date().toISOString(),
  }, { onConflict: 'page_slug' });
}

async function run(): Promise<void> {
  // Primary: pages ranking top 15 for keywords with AI overviews detected
  const { data: aiOverviewKeywords } = await supabase
    .from('serp_features')
    .select('keyword, page_slug, paa_questions, has_ai_overview')
    .eq('has_ai_overview', true)
    .not('page_slug', 'is', null)
    .limit(LIMIT);

  // Secondary: top-ranking high-quality pages (AI overview detection fallback)
  // quality_score column added by migration 0037; fall back to metadata.seo_quality_score until applied
  const { data: topPagesRaw } = await supabase
    .from('pages')
    .select('slug, template, title, meta_description, primary_keyword, body_json, schema_org, metadata')
    .eq('status', 'published')
    .lte('metadata->>current_position', String(MAX_POSITION))
    .limit(LIMIT * 4);

  const topPages = (topPagesRaw ?? [])
    .map((p) => ({
      ...p,
      quality_score: typeof (p.metadata as Record<string, unknown>)?.seo_quality_score === 'number'
        ? (p.metadata as Record<string, unknown>).seo_quality_score as number
        : null,
    }))
    .filter((p) => p.quality_score === null || p.quality_score >= MIN_QUALITY)
    .sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0))
    .slice(0, LIMIT);

  // Build a unified set, AI overview pages take priority
  const slugsProcessed = new Set<string>();
  const queue: Array<{ page: PageRow; paaQuestions: string[] }> = [];

  for (const row of (aiOverviewKeywords ?? []) as Array<{
    keyword: string;
    page_slug: string;
    paa_questions: Array<{ question: string }>;
    has_ai_overview: boolean;
  }>) {
    if (slugsProcessed.has(row.page_slug)) continue;
    slugsProcessed.add(row.page_slug);

    const { data: pageRaw } = await supabase
      .from('pages')
      .select('slug, template, title, meta_description, primary_keyword, body_json, schema_org, metadata')
      .eq('slug', row.page_slug)
      .eq('status', 'published')
      .single();
    const page = pageRaw ? {
      ...pageRaw,
      quality_score: typeof (pageRaw.metadata as Record<string, unknown>)?.seo_quality_score === 'number'
        ? (pageRaw.metadata as Record<string, unknown>).seo_quality_score as number
        : null,
    } : null;

    if (page) {
      queue.push({
        page: page as PageRow,
        paaQuestions: (row.paa_questions ?? []).map((q) => q.question),
      });
    }
  }

  // Fill remaining slots from top pages
  for (const page of (topPages ?? []) as PageRow[]) {
    if (slugsProcessed.has(page.slug) || queue.length >= LIMIT) break;
    slugsProcessed.add(page.slug);

    const { data: serpRow } = await supabase
      .from('serp_features')
      .select('paa_questions')
      .eq('page_slug', page.slug)
      .single();

    const paaQuestions = ((serpRow as any)?.paa_questions ?? []).map((q: { question: string }) => q.question);
    queue.push({ page, paaQuestions });
  }

  console.log(`[geo] Processing ${queue.length} pages (dryRun=${DRY_RUN})`);

  for (const { page, paaQuestions } of queue) {
    await processPage(page, paaQuestions);
  }

  console.log('[geo] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
