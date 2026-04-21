import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildCommercialAudit } from '@/lib/ai-reach';
import type { PageRecord } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.COMMERCIAL_AUDIT_LIMIT ?? 250);

type PageRow = Pick<PageRecord, 'id' | 'slug' | 'template' | 'title' | 'meta_description' | 'primary_keyword' | 'body_json' | 'metadata'>;

function groupCount<T extends { page_id?: string | null }>(rows: T[]) {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.page_id) continue;
    out.set(row.page_id, (out.get(row.page_id) ?? 0) + 1);
  }
  return out;
}

async function run() {
  const pagesResult = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,primary_keyword,body_json,metadata')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .limit(LIMIT);

  if (pagesResult.error) throw pagesResult.error;
  const pages = (pagesResult.data ?? []) as PageRow[];
  const pageIds = pages.map((page) => page.id);
  const pageSlugs = pages.map((page) => page.slug);

  const [refsResult, visualsResult, queriesResult, claimsResult, productsResult] = await Promise.all([
    supabase.from('page_source_references').select('page_id').in('page_id', pageIds),
    supabase.from('page_visual_assets').select('page_id').in('page_id', pageIds).eq('status', 'ready'),
    supabase.from('page_query_targets').select('page_id').in('page_id', pageIds),
    supabase.from('page_claims').select('page_id').in('page_id', pageIds),
    supabase.from('product_specs').select('page_slug').in('page_slug', pageSlugs),
  ]);

  if (refsResult.error) throw refsResult.error;
  if (visualsResult.error) throw visualsResult.error;
  if (queriesResult.error) throw queriesResult.error;
  if (claimsResult.error) throw claimsResult.error;
  if (productsResult.error) throw productsResult.error;

  const refsByPage = groupCount((refsResult.data ?? []) as Array<{ page_id: string }>);
  const visualsByPage = groupCount((visualsResult.data ?? []) as Array<{ page_id: string }>);
  const queriesByPage = groupCount((queriesResult.data ?? []) as Array<{ page_id: string }>);
  const claimsByPage = groupCount((claimsResult.data ?? []) as Array<{ page_id: string }>);
  const productPages = new Set(
    ((productsResult.data ?? []) as Array<{ page_slug: string | null }>)
      .map((row) => row.page_slug)
      .filter((value): value is string => Boolean(value)),
  );

  let audited = 0;

  for (const page of pages) {
    const audit = buildCommercialAudit({
      page,
      referencesCount: refsByPage.get(page.id) ?? 0,
      visualsCount: visualsByPage.get(page.id) ?? 0,
      queryCount: queriesByPage.get(page.id) ?? 0,
      claimCount: claimsByPage.get(page.id) ?? 0,
      hasProductData: productPages.has(page.slug),
    });

    audited += 1;

    if (DRY_RUN) {
      console.log(`[commercial-audit] ${page.slug} score=${audit.score} status=${audit.status} missing=${audit.missingFields.length}`);
      continue;
    }

    const write = await supabase.from('commercial_page_audits').upsert({
      page_id: page.id,
      page_slug: page.slug,
      template: page.template,
      audited_date: new Date().toISOString().slice(0, 10),
      completeness_score: audit.score,
      readiness_status: audit.status,
      present_fields: audit.presentFields,
      missing_fields: audit.missingFields,
      notes: audit.notes,
      metadata: {
        is_commercial: audit.isCommercial,
      },
    }, {
      onConflict: 'page_id,audited_date',
    });

    if (write.error) throw write.error;

    const update = await supabase.from('pages').update({
      commercial_readiness_score: audit.score,
      commercial_readiness_status: audit.status,
      commercial_last_audited_at: new Date().toISOString(),
    }).eq('id', page.id);

    if (update.error) throw update.error;
  }

  console.log(`[commercial-audit] audited=${audited} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
