import { NextResponse } from 'next/server';
import { latestSnapshotMap } from '@/lib/ai-reach';
import { BRAND_ENTITY_SEEDS } from '@/lib/brand-entities';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const siteUrl = process.env.SITE_URL ?? 'https://recoverystack.io';

  const [datasetsResult, entityResult] = await Promise.all([
    supabaseAdmin
      .from('comparison_dataset_snapshots')
      .select('dataset_key,title,snapshot_date,row_count,metadata')
      .order('snapshot_date', { ascending: false })
      .limit(40),
    supabaseAdmin
      .from('topic_entities')
      .select('slug,canonical_name,entity_type,metadata')
      .eq('active', true)
      .in('slug', BRAND_ENTITY_SEEDS.map((seed) => seed.slug))
      .limit(20),
  ]);

  if (datasetsResult.error) {
    return NextResponse.json({ error: datasetsResult.error.message }, { status: 500 });
  }

  const latestDatasets = [...latestSnapshotMap((datasetsResult.data ?? []) as Array<{
    dataset_key: string;
    title: string;
    snapshot_date: string;
    row_count: number;
    metadata?: Record<string, unknown> | null;
  }>).values()].slice(0, 12);

  const entities = (entityResult.data ?? []).map((entity: any) => ({
    slug: entity.slug,
    name: entity.canonical_name,
    type: entity.entity_type,
    description: typeof entity.metadata?.description === 'string' ? entity.metadata.description : null,
    url: `${siteUrl}/entities/${entity.slug}`,
  }));

  return NextResponse.json({
    brand: 'RecoveryStack',
    site_url: siteUrl,
    updated_at: new Date().toISOString(),
    canonical_surfaces: {
      llms: `${siteUrl}/llms.txt`,
      merchant_feed: `${siteUrl}/api/merchant/product-feed`,
      evidence_hub: `${siteUrl}/evidence`,
      research_hub: `${siteUrl}/research`,
      tools_hub: `${siteUrl}/tools`,
      entity_hub: `${siteUrl}/entities`,
    },
    assistant_endpoints: [
      { path: '/api/assistant/catalog', method: 'GET', purpose: 'Return canonical RecoveryStack surfaces, datasets, and entities.' },
      { path: '/api/assistant/recommend', method: 'POST', purpose: 'Recommend next products and pages for a buyer profile.' },
      { path: '/api/assistant/compare', method: 'GET', purpose: 'Compare product-spec rows by slug.' },
      { path: '/api/assistant/openapi', method: 'GET', purpose: 'Return OpenAPI spec for assistant-ready endpoints.' },
    ],
    tools: [
      { slug: 'smart-ring-fit', url: `${siteUrl}/tools/smart-ring-fit`, api: `${siteUrl}/api/tools/buyer-quiz` },
      { slug: 'subscription-cost-calculator', url: `${siteUrl}/tools/subscription-cost-calculator`, api: null },
      { slug: 'platform-compatibility', url: `${siteUrl}/tools/platform-compatibility`, api: null },
    ],
    datasets: latestDatasets.map((dataset) => ({
      key: dataset.dataset_key,
      title: dataset.title,
      row_count: dataset.row_count,
      snapshot_date: dataset.snapshot_date,
      description: typeof dataset.metadata?.description === 'string' ? dataset.metadata.description : null,
      url: `${siteUrl}/research/${dataset.dataset_key}`,
    })),
    entities,
  });
}
