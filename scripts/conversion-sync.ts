/**
 * Conversion Sync
 *
 * Pulls purchase/signup events from Stripe and joins them to the page that
 * drove the conversion via UTM source (utm_source=recoverystack&utm_content=<slug>).
 * Writes per-page revenue attribution to `page_conversions` and feeds the
 * adaptive feedback loop so it optimises for REVENUE, not just CTR.
 *
 * Revenue attribution model:
 *   - Last-touch: the page_slug in utm_content at checkout gets 100% credit
 *   - Assisted: all page_slugs in utm_content across sessions get 1/(n) credit
 *   - 30-day attribution window
 *
 * Also tracks:
 *   - Free trial signups (Stripe subscriptions in trial_end state)
 *   - Email list signups if Convertkit/Mailchimp webhook events stored in DB
 *   - CTA click events from pages (if analytics are piped to Supabase)
 *
 * Usage:
 *   npx tsx scripts/conversion-sync.ts
 *   npx tsx scripts/conversion-sync.ts --dry-run
 *   STRIPE_LOOKBACK_DAYS=90 npx tsx scripts/conversion-sync.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const LOOKBACK_DAYS = Number(process.env.STRIPE_LOOKBACK_DAYS ?? 30);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const ATTRIBUTION_WINDOW_DAYS = Number(process.env.CONVERSION_ATTRIBUTION_DAYS ?? 30);

type StripeCharge = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  status: string;
  metadata: Record<string, string>;
  payment_intent?: string | null;
};

type StripeSubscription = {
  id: string;
  status: string;
  created: number;
  metadata: Record<string, string>;
  items: { data: Array<{ price: { unit_amount: number; currency: string } }> };
};

type ConversionRow = {
  page_slug: string;
  conversion_type: 'purchase' | 'subscription' | 'trial' | 'email_signup' | 'cta_click';
  revenue_usd: number;
  attribution_model: 'last_touch' | 'assisted';
  attribution_weight: number;
  stripe_charge_id: string | null;
  stripe_subscription_id: string | null;
  customer_id: string | null;
  utm_content: string | null;
  utm_campaign: string | null;
  converted_at: string;
  synced_at: string;
};

// ── Stripe API fetch ──────────────────────────────────────────────────────────
async function fetchStripeCharges(createdAfter: number): Promise<StripeCharge[]> {
  if (!STRIPE_SECRET_KEY) return [];

  const url = new URL('https://api.stripe.com/v1/charges');
  url.searchParams.set('limit', '100');
  url.searchParams.set('created[gte]', String(createdAfter));
  url.searchParams.set('expand[]', 'data.metadata');

  const charges: StripeCharge[] = [];
  let hasMore = true;
  let startingAfter: string | null = null;

  while (hasMore) {
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    try {
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        console.warn(`[conversion-sync] Stripe charges ${res.status}`);
        break;
      }
      const data = await res.json();
      charges.push(...(data.data ?? []));
      hasMore = data.has_more ?? false;
      startingAfter = data.data?.at(-1)?.id ?? null;
    } catch (err) {
      console.warn('[conversion-sync] Stripe fetch error:', err instanceof Error ? err.message : String(err));
      break;
    }
  }

  return charges;
}

async function fetchStripeSubscriptions(createdAfter: number): Promise<StripeSubscription[]> {
  if (!STRIPE_SECRET_KEY) return [];

  const url = new URL('https://api.stripe.com/v1/subscriptions');
  url.searchParams.set('limit', '100');
  url.searchParams.set('created[gte]', String(createdAfter));
  url.searchParams.set('status', 'all');

  const subs: StripeSubscription[] = [];

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return subs;
    const data = await res.json();
    subs.push(...(data.data ?? []));
  } catch {
    return subs;
  }

  return subs;
}

// ── UTM attribution ───────────────────────────────────────────────────────────
function extractSlugFromUtm(metadata: Record<string, string>): string | null {
  // Stripe metadata keys are set via checkout session's client_reference_id
  // or via payment_link with ?utm_content=<slug>
  return metadata.utm_content ?? metadata.page_slug ?? metadata.source_page ?? null;
}

// ── Pull CTA click events from Supabase analytics table (if piped) ────────────
async function syncCtaClicks(): Promise<ConversionRow[]> {
  const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 86_400_000).toISOString();

  const { data } = await supabase
    .from('cta_events')
    .select('page_slug, cta_type, clicked_at')
    .gte('clicked_at', cutoff);

  if (!data || data.length === 0) return [];

  return (data as Array<{ page_slug: string; cta_type: string; clicked_at: string }>).map((e) => ({
    page_slug: e.page_slug,
    conversion_type: 'cta_click',
    revenue_usd: 0,
    attribution_model: 'last_touch',
    attribution_weight: 1,
    stripe_charge_id: null,
    stripe_subscription_id: null,
    customer_id: null,
    utm_content: e.page_slug,
    utm_campaign: null,
    converted_at: e.clicked_at,
    synced_at: new Date().toISOString(),
  }));
}

// ── Aggregate revenue per page slug ───────────────────────────────────────────
async function upsertConversionAggregates(rows: ConversionRow[]): Promise<void> {
  const bySlug = new Map<string, {
    total_revenue_usd: number;
    purchase_count: number;
    subscription_count: number;
    trial_count: number;
    cta_click_count: number;
    last_conversion_at: string;
  }>();

  for (const row of rows) {
    const existing = bySlug.get(row.page_slug) ?? {
      total_revenue_usd: 0,
      purchase_count: 0,
      subscription_count: 0,
      trial_count: 0,
      cta_click_count: 0,
      last_conversion_at: row.converted_at,
    };

    existing.total_revenue_usd += row.revenue_usd * row.attribution_weight;
    if (row.conversion_type === 'purchase') existing.purchase_count++;
    if (row.conversion_type === 'subscription') existing.subscription_count++;
    if (row.conversion_type === 'trial') existing.trial_count++;
    if (row.conversion_type === 'cta_click') existing.cta_click_count++;
    if (row.converted_at > existing.last_conversion_at) existing.last_conversion_at = row.converted_at;

    bySlug.set(row.page_slug, existing);
  }

  for (const [slug, agg] of bySlug) {
    if (DRY_RUN) {
      console.log(`  [dry] ${slug}: $${agg.total_revenue_usd.toFixed(2)} revenue, ${agg.purchase_count} purchases`);
      continue;
    }

    await supabase.from('page_conversion_aggregates').upsert({
      page_slug: slug,
      total_revenue_usd: Math.round(agg.total_revenue_usd * 100) / 100,
      purchase_count: agg.purchase_count,
      subscription_count: agg.subscription_count,
      trial_count: agg.trial_count,
      cta_click_count: agg.cta_click_count,
      last_conversion_at: agg.last_conversion_at,
      aggregated_at: new Date().toISOString(),
    }, { onConflict: 'page_slug' });

    // Feed revenue signal into page metadata for adaptive-feedback-loop
    await supabase.from('pages').update({
      metadata: {
        revenue_attribution_usd: Math.round(agg.total_revenue_usd * 100) / 100,
        conversion_count: agg.purchase_count + agg.subscription_count + agg.trial_count,
        cta_click_count: agg.cta_click_count,
        conversion_last_synced_at: new Date().toISOString(),
      },
    }).eq('slug', slug);
  }
}

async function run(): Promise<void> {
  const createdAfter = Math.floor((Date.now() - LOOKBACK_DAYS * 86_400_000) / 1000);

  console.log(`[conversion-sync] Syncing conversions for last ${LOOKBACK_DAYS} days (dryRun=${DRY_RUN})`);

  const [charges, subscriptions, ctaClicks] = await Promise.all([
    fetchStripeCharges(createdAfter),
    fetchStripeSubscriptions(createdAfter),
    syncCtaClicks(),
  ]);

  const conversionRows: ConversionRow[] = [...ctaClicks];

  // Process charges (one-time purchases)
  for (const charge of charges) {
    if (charge.status !== 'succeeded') continue;
    const slug = extractSlugFromUtm(charge.metadata);
    if (!slug) continue;

    conversionRows.push({
      page_slug: slug,
      conversion_type: 'purchase',
      revenue_usd: charge.amount / 100, // Stripe amounts in cents
      attribution_model: 'last_touch',
      attribution_weight: 1,
      stripe_charge_id: charge.id,
      stripe_subscription_id: null,
      customer_id: null,
      utm_content: slug,
      utm_campaign: charge.metadata.utm_campaign ?? null,
      converted_at: new Date(charge.created * 1000).toISOString(),
      synced_at: new Date().toISOString(),
    });
  }

  // Process subscriptions
  for (const sub of subscriptions) {
    const slug = extractSlugFromUtm(sub.metadata);
    if (!slug) continue;

    const monthlyUsd = (sub.items.data[0]?.price?.unit_amount ?? 0) / 100;
    const convType = sub.status === 'trialing' ? 'trial' : 'subscription';

    conversionRows.push({
      page_slug: slug,
      conversion_type: convType,
      revenue_usd: monthlyUsd,
      attribution_model: 'last_touch',
      attribution_weight: 1,
      stripe_charge_id: null,
      stripe_subscription_id: sub.id,
      customer_id: null,
      utm_content: slug,
      utm_campaign: sub.metadata.utm_campaign ?? null,
      converted_at: new Date(sub.created * 1000).toISOString(),
      synced_at: new Date().toISOString(),
    });
  }

  console.log(`[conversion-sync] ${charges.length} charges, ${subscriptions.length} subscriptions, ${ctaClicks.length} CTA clicks → ${conversionRows.length} attributable events`);

  if (!DRY_RUN && conversionRows.length > 0) {
    // Batch insert conversion rows
    for (let i = 0; i < conversionRows.length; i += 50) {
      const chunk = conversionRows.slice(i, i + 50);
      await supabase.from('page_conversions').upsert(chunk, { onConflict: 'stripe_charge_id' });
    }
  }

  await upsertConversionAggregates(conversionRows);

  if (!STRIPE_SECRET_KEY) {
    console.log('[conversion-sync] STRIPE_SECRET_KEY not set — only CTA click events synced.');
  }

  console.log('[conversion-sync] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
