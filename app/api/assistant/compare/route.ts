import { NextResponse } from 'next/server';
import { extractDatasetKeysBySlug, latestSnapshotMap } from '@/lib/ai-reach';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slugs = [
    ...url.searchParams.getAll('slug'),
    ...String(url.searchParams.get('slugs') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter((value, index, list) => list.indexOf(value) === index).slice(0, 4);

  if (!slugs.length) {
    return NextResponse.json({ error: 'missing_slug' }, { status: 400 });
  }

  const [specResult, truthResult, datasetResult] = await Promise.all([
    supabaseAdmin
      .from('product_specs')
      .select('slug,brand,model,price_usd,subscription_required,battery_days,compatible_platforms,page_slug,raw_specs')
      .in('slug', slugs),
    supabaseAdmin
      .from('product_truth_cards')
      .select('product_slug,card_type,title,body')
      .in('product_slug', slugs)
      .eq('status', 'active'),
    supabaseAdmin
      .from('comparison_dataset_snapshots')
      .select('dataset_key,snapshot_date,data')
      .order('snapshot_date', { ascending: false })
      .limit(30),
  ]);

  if (specResult.error) {
    return NextResponse.json({ error: specResult.error.message }, { status: 500 });
  }

  const latestDatasets = [...latestSnapshotMap((datasetResult.data ?? []) as Array<{
    dataset_key: string;
    snapshot_date: string;
    data?: unknown;
  }>).values()];
  const datasetKeysBySlug = extractDatasetKeysBySlug(latestDatasets);

  const truthByProduct = new Map<string, Array<{ type: string; title: string; body: string }>>();
  for (const row of (truthResult.data ?? []) as Array<{ product_slug: string; card_type: string; title: string; body: string }>) {
    const current = truthByProduct.get(row.product_slug) ?? [];
    current.push({ type: row.card_type, title: row.title, body: row.body });
    truthByProduct.set(row.product_slug, current);
  }

  return NextResponse.json({
    compared_at: new Date().toISOString(),
    products: (specResult.data ?? []).map((row: any) => ({
      slug: row.slug,
      title: [row.brand, row.model].filter(Boolean).join(' ') || row.slug,
      price_usd: row.price_usd ?? null,
      subscription_required: row.subscription_required ?? false,
      battery_days: row.battery_days ?? null,
      compatible_platforms: row.compatible_platforms ?? [],
      highlights: (truthByProduct.get(row.slug) ?? []).slice(0, 4),
      supporting_dataset_keys: datasetKeysBySlug.get(row.slug) ?? [],
    })),
  });
}
