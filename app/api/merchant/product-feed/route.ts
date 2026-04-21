import { NextResponse } from 'next/server';
import { extractDatasetKeysBySlug, latestSnapshotMap } from '@/lib/ai-reach';
import { buildMerchantFeedItem } from '@/lib/llm-discovery';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

type ProductSpecRow = {
  id?: string | null;
  slug: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  price_aud: number | null;
  price_usd: number | null;
  affiliate_url: string | null;
  page_slug: string | null;
  subscription_required: boolean | null;
  subscription_price_usd_month: number | null;
  raw_specs?: Record<string, unknown> | null;
};

export async function GET() {
  const siteUrl = process.env.SITE_URL ?? 'https://recoverystack.io';

  const specResult = await supabaseAdmin
    .from('product_specs')
    .select('id,slug,brand,model,category,price_aud,price_usd,affiliate_url,page_slug,subscription_required,subscription_price_usd_month,raw_specs')
    .limit(500);

  if (specResult.error) {
    return NextResponse.json({ error: specResult.error.message }, { status: 500 });
  }

  const specs = (specResult.data ?? []) as ProductSpecRow[];
  const pageSlugs = specs.map((row) => row.page_slug).filter((value): value is string => Boolean(value));

  const [pagesResult, visualsResult, truthResult, datasetResult] = await Promise.all([
    pageSlugs.length
      ? supabaseAdmin
          .from('pages')
          .select('slug,template,meta_description')
          .in('slug', pageSlugs)
      : Promise.resolve({ data: [], error: null }),
    pageSlugs.length
      ? supabaseAdmin
          .from('page_visual_assets')
          .select('page_slug,image_url,sort_order')
          .in('page_slug', pageSlugs)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    specs.length
      ? supabaseAdmin
          .from('product_truth_cards')
          .select('product_slug,card_type,title,body')
          .in('product_slug', specs.map((row) => row.slug))
          .eq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from('comparison_dataset_snapshots')
      .select('dataset_key,snapshot_date,data')
      .order('snapshot_date', { ascending: false })
      .limit(30),
  ]);

  const pageMeta = new Map(
    ((pagesResult.data ?? []) as Array<{ slug: string; template: string; meta_description: string | null }>).map((row) => [
      row.slug,
      row,
    ]),
  );

  const imageByPageSlug = new Map<string, string>();
  for (const row of (visualsResult.data ?? []) as Array<{ page_slug: string; image_url: string | null }>) {
    if (!row.page_slug || !row.image_url || imageByPageSlug.has(row.page_slug)) continue;
    imageByPageSlug.set(row.page_slug, row.image_url);
  }

  const truthByProduct = new Map<string, Array<{ card_type: string; title: string; body: string }>>();
  for (const row of (truthResult.data ?? []) as Array<{ product_slug: string; card_type: string; title: string; body: string }>) {
    const current = truthByProduct.get(row.product_slug) ?? [];
    current.push(row);
    truthByProduct.set(row.product_slug, current);
  }

  const latestDatasets = [...latestSnapshotMap((datasetResult.data ?? []) as Array<{
    dataset_key: string;
    snapshot_date: string;
    data?: unknown;
  }>).values()];
  const datasetKeysBySlug = extractDatasetKeysBySlug(latestDatasets);

  const items = specs.map((row) => {
    const page = row.page_slug ? pageMeta.get(row.page_slug) : null;
    const baseItem = buildMerchantFeedItem(
      {
        ...row,
        id: row.id ?? row.slug,
        image_url: row.page_slug ? imageByPageSlug.get(row.page_slug) ?? null : null,
        description: page?.meta_description ?? null,
        affiliate_url: row.affiliate_url ?? (row.page_slug ? `${siteUrl}/${page?.template ?? 'reviews'}/${row.page_slug}` : null),
      },
      siteUrl,
    );
    const truthCards = truthByProduct.get(row.slug) ?? [];
    const rawSpecs = row.raw_specs ?? {};
    return {
      ...baseItem,
      highlights: truthCards
        .filter((item) => item.card_type !== 'comparison_edge')
        .slice(0, 3)
        .map((item) => item.body),
      comparison_edges: truthCards
        .filter((item) => item.card_type === 'comparison_edge')
        .slice(0, 2)
        .map((item) => item.body),
      supporting_dataset_keys: datasetKeysBySlug.get(row.slug) ?? [],
      compatible_platforms: Array.isArray(rawSpecs.compatible_platforms) ? rawSpecs.compatible_platforms : [],
      battery_days: typeof rawSpecs.battery_days === 'number' ? rawSpecs.battery_days : null,
      evidence_hub_url: `${siteUrl}/evidence`,
      research_url: `${siteUrl}/research`,
    };
  });

  return NextResponse.json(
    {
      feed_version: '1.1',
      generated_at: new Date().toISOString(),
      provider: 'RecoveryStack',
      item_count: items.length,
      items,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=900',
      },
    },
  );
}
