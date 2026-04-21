import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  buildLlmReadinessBreakdown,
  buildLlmReadinessScore,
  getLlmAnswerSection,
  normalizeDiscoveryQuery,
} from '@/lib/llm-discovery';
import type { PageRecord } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.LLM_READINESS_LIMIT ?? 250);

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  meta_description: string;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  body_json: PageRecord['body_json'];
  updated_at: string;
};

function groupBy<T extends { page_id?: string | null; page_slug?: string | null }>(
  rows: T[],
  key: 'page_id' | 'page_slug',
) {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    const current = out.get(value) ?? [];
    current.push(row);
    out.set(value, current);
  }
  return out;
}

function buildEntityRows(page: PageRow) {
  const rows: Array<{
    entity_key: string;
    entity_name: string;
    entity_type: string;
    salience_score: number;
    is_primary: boolean;
  }> = [];

  if (page.primary_keyword) {
    rows.push({
      entity_key: `query:${normalizeDiscoveryQuery(page.primary_keyword)}`,
      entity_name: page.primary_keyword,
      entity_type: 'query',
      salience_score: 92,
      is_primary: true,
    });
  }

  for (const keyword of page.secondary_keywords?.slice(0, 6) ?? []) {
    const normalized = normalizeDiscoveryQuery(keyword);
    if (!normalized || rows.some((row) => row.entity_key === `query:${normalized}`)) continue;
    rows.push({
      entity_key: `query:${normalized}`,
      entity_name: keyword,
      entity_type: 'supporting_query',
      salience_score: 62,
      is_primary: false,
    });
  }

  const topicKey = normalizeDiscoveryQuery(page.title);
  if (topicKey && !rows.some((row) => row.entity_key === `topic:${topicKey}`)) {
    rows.push({
      entity_key: `topic:${topicKey}`,
      entity_name: page.title,
      entity_type: 'topic',
      salience_score: 70,
      is_primary: rows.length === 0,
    });
  }

  return rows;
}

async function run() {
  const pagesResult = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,primary_keyword,secondary_keywords,body_json,updated_at')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(LIMIT);

  if (pagesResult.error) throw pagesResult.error;

  const pages = (pagesResult.data ?? []) as PageRow[];
  if (pages.length === 0) {
    console.log('[llm-readiness] No published pages found.');
    return;
  }

  const pageIds = pages.map((page) => page.id);
  const pageSlugs = pages.map((page) => page.slug);

  const [
    queryTargetsResult,
    claimsResult,
    visualsResult,
    refsResult,
    indexStatusResult,
    productSpecsResult,
  ] = await Promise.all([
    supabase.from('page_query_targets').select('page_id').in('page_id', pageIds),
    supabase.from('page_claims').select('page_id,status,confidence_score').in('page_id', pageIds),
    supabase.from('page_visual_assets').select('page_id').in('page_id', pageIds).eq('status', 'ready'),
    supabase.from('page_source_references').select('page_id,title,url,source_domain').in('page_id', pageIds),
    supabase.from('page_index_status').select('page_slug,index_status').in('page_slug', pageSlugs),
    supabase.from('product_specs').select('page_slug').in('page_slug', pageSlugs),
  ]);

  const queryTargetsByPage = groupBy((queryTargetsResult.data ?? []) as Array<{ page_id: string }>, 'page_id');
  const claimsByPage = groupBy((claimsResult.data ?? []) as Array<{ page_id: string; status: string | null; confidence_score: number | null }>, 'page_id');
  const visualsByPage = groupBy((visualsResult.data ?? []) as Array<{ page_id: string }>, 'page_id');
  const refsByPage = groupBy((refsResult.data ?? []) as Array<{ page_id: string; title: string; url: string; source_domain: string | null }>, 'page_id');
  const indexStatusBySlug = new Map(
    ((indexStatusResult.data ?? []) as Array<{ page_slug: string; index_status: string | null }>).map((row) => [
      row.page_slug,
      row.index_status,
    ]),
  );
  const productPageSlugs = new Set(
    ((productSpecsResult.data ?? []) as Array<{ page_slug: string | null }>)
      .map((row) => row.page_slug)
      .filter((value): value is string => Boolean(value)),
  );

  let scored = 0;

  for (const page of pages) {
    const references = (refsByPage.get(page.id) ?? []).map((row) => ({
      title: row.title,
      url: row.url,
      source: row.source_domain ?? null,
    }));
    const claims = claimsByPage.get(page.id) ?? [];
    const breakdown = buildLlmReadinessBreakdown({
      page,
      references,
      claims,
      queryCount: (queryTargetsByPage.get(page.id) ?? []).length,
      visualCount: (visualsByPage.get(page.id) ?? []).length,
      hasProductData: productPageSlugs.has(page.slug),
      indexStatus: indexStatusBySlug.get(page.slug) ?? null,
    });
    const score = buildLlmReadinessScore(breakdown);

    const observations: Array<{
      observation_key: string;
      observation_type: string;
      severity: number;
      detail: string;
    }> = [];

    if (!getLlmAnswerSection(page)) {
      observations.push({
        observation_key: 'missing-llm-answer',
        observation_type: 'missing_answer_block',
        severity: 78,
        detail: 'Page does not contain a first-class llm_answer section.',
      });
    }
    if (references.length < 3) {
      observations.push({
        observation_key: 'thin-citations',
        observation_type: 'citation_depth',
        severity: 72,
        detail: `Only ${references.length} source reference(s) available for citation.`,
      });
    }
    if (breakdown.crawlability < 70) {
      observations.push({
        observation_key: 'crawlability-gap',
        observation_type: 'crawlability',
        severity: 80,
        detail: `Index status is ${indexStatusBySlug.get(page.slug) ?? 'UNKNOWN'}.`,
      });
    }
    if (breakdown.freshness < 60) {
      observations.push({
        observation_key: 'freshness-gap',
        observation_type: 'freshness',
        severity: 65,
        detail: `Page freshness score is ${breakdown.freshness}.`,
      });
    }
    if (['reviews', 'alternatives', 'costs', 'compatibility', 'guides'].includes(page.template) && breakdown.product_data < 55) {
      observations.push({
        observation_key: 'product-truth-gap',
        observation_type: 'product_data',
        severity: 70,
        detail: 'Commercial page lacks strong product-truth or asset coverage.',
      });
    }

    const entityRows = buildEntityRows(page);

    if (DRY_RUN) {
      console.log(`[llm-readiness] ${page.slug} score=${score.total} status=${score.status} observations=${observations.length}`);
      scored += 1;
      continue;
    }

    await supabase.from('page_llm_scores').upsert({
      page_id: page.id,
      page_slug: page.slug,
      score_date: new Date().toISOString().slice(0, 10),
      total_score: score.total,
      readiness_status: score.status,
      breakdown,
      notes: observations.map((item) => item.detail),
    }, {
      onConflict: 'page_id,score_date',
    });

    await supabase.from('page_llm_observations').delete().eq('page_id', page.id).eq('status', 'open');
    if (observations.length > 0) {
      await supabase.from('page_llm_observations').insert(
        observations.map((item) => ({
          page_id: page.id,
          page_slug: page.slug,
          observation_key: item.observation_key,
          observation_type: item.observation_type,
          severity: item.severity,
          status: 'open',
          detail: item.detail,
          metadata: {},
        })),
      );
    }

    await supabase.from('page_entities').delete().eq('page_id', page.id).in('entity_type', ['query', 'supporting_query', 'topic']);
    if (entityRows.length > 0) {
      await supabase.from('page_entities').insert(
        entityRows.map((entity) => ({
          page_id: page.id,
          page_slug: page.slug,
          entity_key: entity.entity_key,
          entity_name: entity.entity_name,
          entity_type: entity.entity_type,
          salience_score: entity.salience_score,
          is_primary: entity.is_primary,
          metadata: {},
        })),
      );
    }

    await supabase.from('pages').update({
      llm_readiness_score: score.total,
      llm_readiness_status: score.status,
      llm_last_scored_at: new Date().toISOString(),
    }).eq('id', page.id);

    scored += 1;
  }

  console.log(`[llm-readiness] scored=${scored} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
