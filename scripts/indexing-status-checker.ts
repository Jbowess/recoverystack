/**
 * GSC Indexing Status Checker
 *
 * Polls the Google URL Inspection API to verify each published page's
 * actual index status in Google Search. Writes results to pages.metadata
 * and logs a summary of indexed vs not-indexed pages.
 *
 * Google URL Inspection API:
 *   POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 *
 * Requires GSC_SERVICE_ACCOUNT_JSON with Search Console access.
 * No-ops when env var is missing.
 *
 * Run: npm run indexing:status
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';
const GSC_PROPERTY = process.env.GSC_PROPERTY ?? SITE_URL;

// Rate limit: Google allows ~2400 requests/day on the URL Inspection API
// We check 50 pages per run to stay well within limits
const PAGES_PER_RUN = 50;
const DELAY_MS = 500; // 500ms between requests = ~120/min

async function getAccessToken(): Promise<string> {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON not set');

  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const scope = 'https://www.googleapis.com/auth/webmasters.readonly';

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: key.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }),
  ).toString('base64url');

  const crypto = await import('node:crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(key.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const json = await res.json();
  return json.access_token as string;
}

type IndexStatus =
  | 'INDEXED'
  | 'NOT_INDEXED'
  | 'CRAWLED_NOT_INDEXED'
  | 'DISCOVERED_NOT_INDEXED'
  | 'EXCLUDED'
  | 'UNKNOWN';

interface InspectionResult {
  url: string;
  indexStatus: IndexStatus;
  coverageState: string;
  robotsTxtState: string;
  indexingState: string;
  lastCrawlTime: string | null;
  verdict: string;
}

async function inspectUrl(url: string, accessToken: string): Promise<InspectionResult | null> {
  try {
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionUrl: url,
        siteUrl: GSC_PROPERTY,
      }),
    });

    if (res.status === 429) {
      console.warn('[indexing-status] Rate limited — stopping early');
      return null;
    }

    if (!res.ok) {
      console.warn(`[indexing-status] Inspect failed for ${url}: ${res.status}`);
      return null;
    }

    const json = await res.json();
    const result = json?.inspectionResult;
    if (!result) return null;

    const indexResult = result.indexStatusResult ?? {};
    const coverageState = indexResult.coverageState ?? 'UNKNOWN';

    // Map coverage state to simplified status
    let indexStatus: IndexStatus = 'UNKNOWN';
    if (coverageState.includes('Submitted and indexed') || coverageState.includes('Indexed')) {
      indexStatus = 'INDEXED';
    } else if (coverageState.includes('Crawled')) {
      indexStatus = 'CRAWLED_NOT_INDEXED';
    } else if (coverageState.includes('Discovered')) {
      indexStatus = 'DISCOVERED_NOT_INDEXED';
    } else if (coverageState.includes('Excluded')) {
      indexStatus = 'EXCLUDED';
    } else if (coverageState.includes('Error') || coverageState.includes('not indexed')) {
      indexStatus = 'NOT_INDEXED';
    }

    return {
      url,
      indexStatus,
      coverageState,
      robotsTxtState: indexResult.robotsTxtState ?? 'UNKNOWN',
      indexingState: indexResult.indexingState ?? 'UNKNOWN',
      lastCrawlTime: indexResult.lastCrawlTime ?? null,
      verdict: result.verdict ?? 'NEUTRAL',
    };
  } catch (err) {
    console.warn(`[indexing-status] Error inspecting ${url}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function run() {
  if (!process.env.GSC_SERVICE_ACCOUNT_JSON) {
    console.log('[indexing-status] GSC_SERVICE_ACCOUNT_JSON not set — skipping.');
    return;
  }

  // Fetch published pages, prioritising ones never checked or checked longest ago
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id, slug, template, metadata')
    .eq('status', 'published')
    .order('updated_at', { ascending: true })
    .limit(PAGES_PER_RUN);

  if (error) throw error;
  if (!pages || pages.length === 0) {
    console.log('[indexing-status] No published pages found.');
    return;
  }

  console.log(`[indexing-status] Checking ${pages.length} pages...`);

  const accessToken = await getAccessToken();
  const summary = { indexed: 0, notIndexed: 0, crawledNotIndexed: 0, discoveredNotIndexed: 0, unknown: 0, excluded: 0 };

  for (const page of pages) {
    const url = `${SITE_URL}/${page.template}/${page.slug}`;
    const result = await inspectUrl(url, accessToken);

    if (!result) break; // Rate limited or fatal error

    // Update page metadata with indexing status
    const updatedMeta = {
      ...(page.metadata ?? {}),
      index_status: result.indexStatus,
      index_coverage_state: result.coverageState,
      index_last_crawl: result.lastCrawlTime,
      index_checked_at: new Date().toISOString(),
    };

    await supabase.from('pages').update({ metadata: updatedMeta }).eq('id', page.id);

    // Count for summary
    switch (result.indexStatus) {
      case 'INDEXED': summary.indexed++; break;
      case 'NOT_INDEXED': summary.notIndexed++; break;
      case 'CRAWLED_NOT_INDEXED': summary.crawledNotIndexed++; break;
      case 'DISCOVERED_NOT_INDEXED': summary.discoveredNotIndexed++; break;
      case 'EXCLUDED': summary.excluded++; break;
      default: summary.unknown++;
    }

    const statusIcon = result.indexStatus === 'INDEXED' ? '✓' : '✗';
    console.log(`  ${statusIcon} ${page.slug} — ${result.coverageState}`);

    // Polite delay
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const indexRate = total > 0 ? ((summary.indexed / total) * 100).toFixed(1) : '0';

  console.log(`\n[indexing-status] Results for ${total} pages:`);
  console.log(`  Indexed:               ${summary.indexed} (${indexRate}%)`);
  console.log(`  Crawled, not indexed:  ${summary.crawledNotIndexed}`);
  console.log(`  Discovered, not indexed: ${summary.discoveredNotIndexed}`);
  console.log(`  Not indexed:           ${summary.notIndexed}`);
  console.log(`  Excluded:              ${summary.excluded}`);
  console.log(`  Unknown:               ${summary.unknown}`);

  if (summary.crawledNotIndexed > 0 || summary.discoveredNotIndexed > 0) {
    console.warn(`\n[indexing-status] ACTION NEEDED: ${summary.crawledNotIndexed + summary.discoveredNotIndexed} pages crawled but not indexed. Check content quality and thin page signals.`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
