import { NextResponse } from 'next/server';
import { buildBuyerQuizResult } from '@/lib/company-growth';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RecommendPayload = {
  priority?: 'sleep' | 'cost' | 'accuracy' | 'training';
  platform?: 'ios' | 'android' | 'any';
  hatesSubscription?: boolean;
  prefersNoScreen?: boolean;
  maxPriceUsd?: number | null;
};

function supportsPlatform(platforms: string[] | null, target: 'ios' | 'android' | 'any') {
  if (target === 'any') return true;
  const normalized = (platforms ?? []).map((value) => value.toLowerCase());
  if (target === 'ios') return normalized.some((value) => value.includes('ios') || value.includes('iphone') || value.includes('apple'));
  if (target === 'android') return normalized.some((value) => value.includes('android'));
  return true;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as RecommendPayload | null;
  if (!body?.priority) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const result = buildBuyerQuizResult({
    priority: body.priority,
    hatesSubscription: Boolean(body.hatesSubscription),
    prefersNoScreen: Boolean(body.prefersNoScreen),
  });

  const specResult = await supabaseAdmin
    .from('product_specs')
    .select('slug,brand,model,price_usd,subscription_required,battery_days,compatible_platforms,page_slug,affiliate_url')
    .eq('status', 'active')
    .limit(40);

  if (specResult.error) {
    return NextResponse.json({ error: specResult.error.message }, { status: 500 });
  }

  const recommendedProducts = (specResult.data ?? [])
    .filter((row: any) => supportsPlatform(row.compatible_platforms ?? null, body.platform ?? 'any'))
    .filter((row: any) => !body.hatesSubscription || !row.subscription_required)
    .filter((row: any) => typeof body.maxPriceUsd !== 'number' || typeof row.price_usd !== 'number' || row.price_usd <= body.maxPriceUsd)
    .sort((left: any, right: any) => {
      const leftPenalty = left.subscription_required ? 1 : 0;
      const rightPenalty = right.subscription_required ? 1 : 0;
      if (leftPenalty !== rightPenalty) return leftPenalty - rightPenalty;
      return Number(left.price_usd ?? 0) - Number(right.price_usd ?? 0);
    })
    .slice(0, 5)
    .map((row: any) => ({
      slug: row.slug,
      title: [row.brand, row.model].filter(Boolean).join(' ') || row.slug,
      price_usd: row.price_usd ?? null,
      subscription_required: row.subscription_required ?? false,
      battery_days: row.battery_days ?? null,
      compatible_platforms: row.compatible_platforms ?? [],
      url: row.affiliate_url ?? (row.page_slug ? `${process.env.SITE_URL ?? 'https://recoverystack.io'}/reviews/${row.page_slug}` : null),
    }));

  await supabaseAdmin.from('tool_usage_events').insert({
    tool_slug: 'assistant-recommend',
    event_type: 'recommendation_requested',
    metadata: {
      priority: body.priority,
      platform: body.platform ?? 'any',
      hates_subscription: Boolean(body.hatesSubscription),
      prefers_no_screen: Boolean(body.prefersNoScreen),
      result_count: recommendedProducts.length,
    },
  });

  return NextResponse.json({
    result,
    recommended_products: recommendedProducts,
    next_surfaces: [
      `${process.env.SITE_URL ?? 'https://recoverystack.io'}/evidence`,
      `${process.env.SITE_URL ?? 'https://recoverystack.io'}/research`,
      `${process.env.SITE_URL ?? 'https://recoverystack.io'}/tools`,
    ],
  });
}
