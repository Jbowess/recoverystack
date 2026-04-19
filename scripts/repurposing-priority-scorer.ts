import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function scorePage(page: any, assets: any[], conversions: any) {
  let score = 30;
  if (['alternatives', 'reviews', 'costs', 'compatibility'].includes(page.template)) score += 20;
  if (page.primary_keyword?.toLowerCase().includes('smart ring')) score += 10;
  if ((page.metadata?.distribution_evidence ?? []).length >= 2) score += 12;
  if ((page.metadata?.app_review_signals ?? []).length >= 1) score += 8;
  if ((page.metadata?.community_signals ?? []).length >= 1) score += 8;
  if (assets.length >= 8) score += 8;
  if ((conversions?.conversion_count ?? 0) > 0) score += 10;
  if ((conversions?.cta_click_count ?? 0) > 10) score += 6;
  return Math.min(99, score);
}

async function run() {
  const [pagesResult, assetsResult, conversionsResult] = await Promise.all([
    supabase.from('pages').select('slug,template,primary_keyword,metadata').in('status', ['approved', 'published']).limit(500),
    supabase.from('distribution_assets').select('page_slug,asset_type,payload').limit(2000),
    supabase.from('page_conversion_aggregates').select('page_slug,conversion_count,cta_click_count').limit(500),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  const pages = pagesResult.data ?? [];
  const assets = assetsResult.error?.message?.includes('distribution_assets') ? [] : (assetsResult.data ?? []);
  const conversions = conversionsResult.error?.message?.includes('page_conversion_aggregates') ? [] : (conversionsResult.data ?? []);

  const assetsBySlug = new Map<string, any[]>();
  for (const asset of assets as any[]) {
    const list = assetsBySlug.get(asset.page_slug) ?? [];
    list.push(asset);
    assetsBySlug.set(asset.page_slug, list);
  }

  const conversionsBySlug = new Map<string, any>((conversions as any[]).map((row) => [row.page_slug, row]));
  let written = 0;

  for (const page of pages as any[]) {
    const pageAssets = assetsBySlug.get(page.slug) ?? [];
    const conversion = conversionsBySlug.get(page.slug) ?? null;
    const priorityScore = scorePage(page, pageAssets, conversion);
    const scoreBreakdown = {
      asset_count: pageAssets.length,
      repurposing_scores: pageAssets.map((asset) => asset.payload?.repurposing_score).filter(Boolean).slice(0, 5),
      conversion_count: conversion?.conversion_count ?? 0,
      cta_click_count: conversion?.cta_click_count ?? 0,
      evidence_count: (page.metadata?.distribution_evidence ?? []).length,
    };

    written += 1;
    if (DRY_RUN) continue;

    const { error } = await supabase.from('repurposing_priority_scores').upsert({
      page_slug: page.slug,
      priority_score: priorityScore,
      score_breakdown: scoreBreakdown,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'page_slug' });

    if (error?.message?.includes('repurposing_priority_scores')) {
      console.log('[repurposing-priority-scorer] repurposing_priority_scores missing - skipping persistence.');
      break;
    }
    if (error) throw error;
  }

  console.log(`[repurposing-priority-scorer] pages=${pages.length} written=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
