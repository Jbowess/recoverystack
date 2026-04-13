/**
 * Competitor Price Scraper
 *
 * Scrapes a configurable list of competitor product URLs using fetch +
 * HTML parsing (no Playwright). Parses prices from:
 *   - <meta property="product:price:amount">
 *   - JSON-LD Product schema on page
 *   - Common price class selectors
 *
 * Target URLs configured via PRICE_SCRAPE_URLS env var (JSON array):
 *   [{"retailer": "Amazon AU", "product_name": "WHOOP 4.0", "url": "https://..."}]
 *
 * Upserts into price_snapshots table.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ScrapeTarget {
  retailer: string;
  product_name: string;
  url: string;
}

interface PriceResult {
  price: number | null;
  currency: string;
  inStock: boolean | null;
}

function parseMetaPrice(html: string): number | null {
  const match = html.match(/<meta[^>]+property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i);
  if (match?.[1]) {
    const val = parseFloat(match[1].replace(/[^0-9.]/g, ''));
    return Number.isFinite(val) ? val : null;
  }
  return null;
}

function parseMetaCurrency(html: string): string {
  const match = html.match(/<meta[^>]+property=["']product:price:currency["'][^>]*content=["']([A-Z]{3})["']/i);
  return match?.[1] ?? 'AUD';
}

function parseJsonLdPrice(html: string): { price: number | null; currency: string; inStock: boolean | null } {
  const scriptMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scriptMatches) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const items: unknown[] = Array.isArray(data['@graph']) ? (data['@graph'] as unknown[]) : [data];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        if (obj['@type'] !== 'Product') continue;

        const offers = obj.offers as Record<string, unknown> | null | undefined;
        if (!offers) continue;

        const priceRaw = offers.price ?? offers.lowPrice;
        const price = priceRaw != null ? parseFloat(String(priceRaw).replace(/[^0-9.]/g, '')) : null;
        const currency = typeof offers.priceCurrency === 'string' ? offers.priceCurrency : 'AUD';
        const availability = typeof offers.availability === 'string' ? offers.availability : '';
        const inStock = availability ? availability.toLowerCase().includes('instock') : null;

        return {
          price: price !== null && Number.isFinite(price) ? price : null,
          currency,
          inStock,
        };
      }
    } catch {
      // skip invalid JSON
    }
  }
  return { price: null, currency: 'AUD', inStock: null };
}

function parseClassPrice(html: string): number | null {
  // Common price selectors as text patterns
  const patterns = [
    /<span[^>]+class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
    /<div[^>]+class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<p[^>]+class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      const stripped = match[1].replace(/<[^>]+>/g, '').trim();
      const val = parseFloat(stripped.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(val) && val > 0) return val;
    }
  }
  return null;
}

async function scrapePrice(target: ScrapeTarget): Promise<PriceResult> {
  try {
    const res = await fetch(target.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-AU,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[price-scraper] HTTP ${res.status} for ${target.url}`);
      return { price: null, currency: 'AUD', inStock: null };
    }

    const html = await res.text();

    // Try JSON-LD first (most reliable)
    const jsonLdResult = parseJsonLdPrice(html);
    if (jsonLdResult.price !== null) return jsonLdResult;

    // Try meta tags
    const metaPrice = parseMetaPrice(html);
    if (metaPrice !== null) {
      return { price: metaPrice, currency: parseMetaCurrency(html), inStock: null };
    }

    // Try class-based parsing
    const classPrice = parseClassPrice(html);
    if (classPrice !== null) {
      return { price: classPrice, currency: parseMetaCurrency(html), inStock: null };
    }

    console.warn(`[price-scraper] Could not extract price from ${target.url}`);
    return { price: null, currency: 'AUD', inStock: null };
  } catch (err) {
    console.warn(`[price-scraper] Error scraping ${target.url}:`, err instanceof Error ? err.message : String(err));
    return { price: null, currency: 'AUD', inStock: null };
  }
}

async function run() {
  const urlsRaw = process.env.PRICE_SCRAPE_URLS;
  if (!urlsRaw) {
    console.log('[price-scraper] PRICE_SCRAPE_URLS not set — skipping.');
    return;
  }

  let targets: ScrapeTarget[];
  try {
    targets = JSON.parse(urlsRaw) as ScrapeTarget[];
  } catch {
    console.error('[price-scraper] Failed to parse PRICE_SCRAPE_URLS — expected JSON array.');
    return;
  }

  if (!Array.isArray(targets) || targets.length === 0) {
    console.log('[price-scraper] No scrape targets configured.');
    return;
  }

  console.log(`[price-scraper] Scraping prices for ${targets.length} product(s)...`);

  let scraped = 0;
  for (const target of targets) {
    const result = await scrapePrice(target);

    const { error } = await supabase.from('price_snapshots').upsert(
      {
        retailer: target.retailer,
        product_name: target.product_name,
        price: result.price,
        currency: result.currency,
        in_stock: result.inStock,
        url: target.url,
        captured_at: new Date().toISOString(),
      },
      { onConflict: 'url' },
    );

    if (error) {
      console.warn(`[price-scraper] Failed to upsert ${target.url}: ${error.message}`);
    } else {
      scraped++;
      const priceStr = result.price !== null ? `${result.currency} ${result.price.toFixed(2)}` : 'N/A';
      console.log(`[price-scraper] ${target.product_name} @ ${target.retailer}: ${priceStr}`);
    }

    // Polite delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.log(`[price-scraper] Scraped ${scraped}/${targets.length} products.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
