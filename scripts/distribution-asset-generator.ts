import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildDistributionAssets, isDistributablePage, type DistributionPageInput } from '@/lib/distribution-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.DISTRIBUTION_ASSET_LIMIT ?? 50);

type ConversionAggregateRow = {
  page_slug: string;
  total_revenue_usd?: number | null;
  conversion_count?: number | null;
  purchase_count?: number | null;
  cta_click_count?: number | null;
};

type AppReviewAggregateRow = {
  app_slug: string;
  avg_rating?: number | null;
  positive_pct?: number | null;
  top_pain_points?: string[] | null;
  top_praised_features?: string[] | null;
  top_themes?: string[] | null;
};

type CommunityQaRow = {
  page_slug: string;
  question: string;
  sentiment?: string | null;
  user_language?: string | null;
};

type SnapshotRow = {
  dataset_key: string;
  snapshot_date: string;
  data: unknown;
};

async function loadPublishedPages(limit: number) {
  const modern = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,metadata,published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (modern.error?.message?.includes('metadata')) {
    const legacy = await supabase
      .from('pages')
      .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []).map((row) => ({ ...row, metadata: null }));
  }

  if (modern.error) throw modern.error;
  return modern.data ?? [];
}

function normalizeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function buildDatasetSignals(page: DistributionPageInput, snapshots: SnapshotRow[]) {
  const haystack = [
    page.slug,
    page.title,
    page.primary_keyword ?? '',
    page.meta_description ?? '',
  ].join(' ').toLowerCase();

  const rows = snapshots.flatMap((snapshot) => {
    if (!Array.isArray(snapshot.data)) return [];
    return (snapshot.data as Array<Record<string, unknown>>)
      .filter((row) => {
        const slug = typeof row.slug === 'string' ? row.slug : '';
        const brand = typeof row.brand === 'string' ? row.brand : '';
        const model = typeof row.model === 'string' ? row.model : '';
        return [slug, brand, model].some((value) => value && haystack.includes(value.toLowerCase()));
      })
      .slice(0, 2)
      .map((row) => {
        const brand = typeof row.brand === 'string' ? row.brand : 'Device';
        const model = typeof row.model === 'string' ? row.model : '';
        const yearOne = typeof row.year_one_cost_usd === 'number' ? `$${row.year_one_cost_usd} year-one cost` : null;
        const price = typeof row.price_usd === 'number' ? `$${row.price_usd} hardware price` : null;
        const battery = typeof row.battery_days === 'number' ? `${row.battery_days} day battery` : null;
        const signal = [brand, model, yearOne, price, battery].filter(Boolean).join(' ');
        return signal.trim();
      });
  });

  return Array.from(new Set(rows)).slice(0, 4);
}

function buildAppReviewSignals(page: DistributionPageInput, appRows: AppReviewAggregateRow[]) {
  const haystack = [
    page.slug,
    page.title,
    page.primary_keyword ?? '',
    page.meta_description ?? '',
  ].join(' ').toLowerCase();

  return appRows
    .filter((row) => haystack.includes(row.app_slug.replace(/-/g, ' ')) || haystack.includes(row.app_slug))
    .slice(0, 2)
    .flatMap((row) => {
      const signals: string[] = [];
      if (typeof row.avg_rating === 'number') signals.push(`${row.app_slug} app rating ${row.avg_rating.toFixed(1)}/5`);
      if (Array.isArray(row.top_pain_points) && row.top_pain_points[0]) signals.push(`${row.app_slug} complaint: ${row.top_pain_points[0]}`);
      if (Array.isArray(row.top_praised_features) && row.top_praised_features[0]) signals.push(`${row.app_slug} praise: ${row.top_praised_features[0]}`);
      return signals;
    })
    .slice(0, 4);
}

function buildCommunitySignals(page: DistributionPageInput, communityRows: CommunityQaRow[]) {
  return communityRows
    .filter((row) => row.page_slug === page.slug)
    .slice(0, 3)
    .map((row) => row.user_language || row.question)
    .filter((value): value is string => Boolean(value));
}

function buildConversionSignals(page: DistributionPageInput, conversionMap: Map<string, ConversionAggregateRow>) {
  const row = conversionMap.get(normalizeSlug(page.slug));
  if (!row) return [];

  const signals: string[] = [];
  if (typeof row.purchase_count === 'number' && row.purchase_count > 0) signals.push(`${row.purchase_count} purchases attributed`);
  if (typeof row.conversion_count === 'number' && row.conversion_count > 0) signals.push(`${row.conversion_count} tracked conversions`);
  if (typeof row.cta_click_count === 'number' && row.cta_click_count > 0) signals.push(`${row.cta_click_count} CTA clicks`);
  if (typeof row.total_revenue_usd === 'number' && row.total_revenue_usd > 0) signals.push(`$${Math.round(row.total_revenue_usd)} attributed revenue`);
  return signals;
}

async function loadEnrichment() {
  const [conversionsResult, appReviewsResult, communityResult, snapshotResult] = await Promise.all([
    supabase
      .from('page_conversion_aggregates')
      .select('page_slug,total_revenue_usd,conversion_count,purchase_count,cta_click_count')
      .limit(500),
    supabase
      .from('app_review_aggregates')
      .select('app_slug,avg_rating,positive_pct,top_pain_points,top_praised_features,top_themes')
      .limit(100),
    supabase
      .from('community_qa')
      .select('page_slug,question,sentiment,user_language')
      .limit(200),
    supabase
      .from('comparison_dataset_snapshots')
      .select('dataset_key,snapshot_date,data')
      .order('snapshot_date', { ascending: false })
      .limit(40),
  ]);

  return {
    conversions: conversionsResult.error?.message?.includes('page_conversion_aggregates') ? [] : ((conversionsResult.data ?? []) as ConversionAggregateRow[]),
    appReviews: appReviewsResult.error?.message?.includes('app_review_aggregates') ? [] : ((appReviewsResult.data ?? []) as AppReviewAggregateRow[]),
    community: communityResult.error?.message?.includes('community_qa') ? [] : ((communityResult.data ?? []) as CommunityQaRow[]),
    snapshots: snapshotResult.error?.message?.includes('comparison_dataset_snapshots') ? [] : ((snapshotResult.data ?? []) as SnapshotRow[]),
  };
}

function enrichPage(
  page: DistributionPageInput,
  conversionMap: Map<string, ConversionAggregateRow>,
  appReviews: AppReviewAggregateRow[],
  communityRows: CommunityQaRow[],
  snapshots: SnapshotRow[],
): DistributionPageInput {
  const existingMetadata = page.metadata ?? {};
  const appReviewSignals = buildAppReviewSignals(page, appReviews);
  const communitySignals = buildCommunitySignals(page, communityRows);
  const conversionSignals = buildConversionSignals(page, conversionMap);
  const distributionEvidence = buildDatasetSignals(page, snapshots);

  return {
    ...page,
    metadata: {
      ...existingMetadata,
      distribution_evidence: distributionEvidence,
      app_review_signals: appReviewSignals,
      community_signals: communitySignals,
      conversion_signals: conversionSignals,
      repurposing_ready_at: new Date().toISOString(),
    },
  };
}

async function run() {
  const [rawPages, enrichment] = await Promise.all([
    loadPublishedPages(LIMIT),
    loadEnrichment(),
  ]);

  const conversionMap = new Map(
    enrichment.conversions.map((row) => [normalizeSlug(row.page_slug), row]),
  );

  const pages = (rawPages as DistributionPageInput[])
    .filter(isDistributablePage)
    .map((page) =>
      enrichPage(
        page,
        conversionMap,
        enrichment.appReviews,
        enrichment.community,
        enrichment.snapshots,
      ),
    );
  let assetCount = 0;

  for (const page of pages) {
    const assets = buildDistributionAssets(page);
    assetCount += assets.length;

    if (DRY_RUN) {
      for (const asset of assets) {
        console.log(`[distribution-asset-generator] ${page.slug} -> ${asset.channel}/${asset.assetType}`);
      }
      continue;
    }

    const rows = assets.map((asset) => ({
      page_id: page.id,
      page_slug: page.slug,
      page_template: page.template,
      channel: asset.channel,
      asset_type: asset.assetType,
      status: 'draft',
      title: asset.title,
      hook: asset.hook,
      summary: asset.summary,
      body: asset.body,
      cta_label: asset.ctaLabel,
      cta_url: asset.ctaUrl,
      hashtags: asset.hashtags,
      payload: asset.payload,
      source_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
    }));

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, {
      onConflict: 'page_id,channel,asset_type',
    });

    if (upsertError) {
      console.warn(`[distribution-asset-generator] ${page.slug}: ${upsertError.message}`);
    }
  }

  console.log(`[distribution-asset-generator] pages=${pages.length} assets=${assetCount} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
