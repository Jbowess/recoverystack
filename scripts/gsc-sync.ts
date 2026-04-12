import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const SITE_URL = process.env.SITE_URL ?? 'https://www.recoverystack.io';
const GSC_PROPERTY = process.env.GSC_PROPERTY ?? SITE_URL;

type PageMetricTarget = {
  id: string;
  slug: string;
  template: string;
  primary_keyword: string | null;
  search_volume: number | null;
};

type GscSlugMetric = {
  slug: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/**
 * Obtain a Google OAuth2 access token using a service account JSON key.
 * Expects GSC_SERVICE_ACCOUNT_JSON env var containing the full JSON key.
 */
async function getGscAccessToken(): Promise<string> {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing GSC_SERVICE_ACCOUNT_JSON env var');

  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const scope = 'https://www.googleapis.com/auth/webmasters.readonly';

  // Build JWT
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

  if (!res.ok) throw new Error(`GSC token exchange failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('GSC token response missing access_token');
  return json.access_token as string;
}

async function loadMetricTargets(limit = 200): Promise<PageMetricTarget[]> {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,primary_keyword,search_volume')
    .in('status', ['published', 'draft'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as PageMetricTarget[];
}

/**
 * Fetch real metrics from Google Search Console API.
 * Falls back to placeholder mode if GSC_SERVICE_ACCOUNT_JSON is not set.
 */
async function fetchSlugMetricsFromGsc(targets: PageMetricTarget[]): Promise<GscSlugMetric[]> {
  if (!process.env.GSC_SERVICE_ACCOUNT_JSON) {
    console.log(`[gsc-sync] GSC_SERVICE_ACCOUNT_JSON not set — running in placeholder mode for ${targets.length} slug(s).`);
    return targets.map((t) => ({
      slug: t.slug,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    }));
  }

  const accessToken = await getGscAccessToken();

  // Query last 28 days of data, grouped by page
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 28 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  // Build a set of page URLs we care about
  const pageUrls = new Map<string, PageMetricTarget>();
  for (const t of targets) {
    const url = `${SITE_URL}/${t.template}/${t.slug}`;
    pageUrls.set(url, t);
  }

  // GSC API allows max 25,000 rows per request; paginate if needed
  const allRows: GscSlugMetric[] = [];
  let startRow = 0;
  const ROW_LIMIT = 5000;

  while (true) {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_PROPERTY)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          dimensions: ['page'],
          rowLimit: ROW_LIMIT,
          startRow,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GSC searchAnalytics/query failed ${res.status}: ${text}`);
    }

    const json = await res.json();
    const rows = json.rows as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> | undefined;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const pageUrl = row.keys[0];
      const target = pageUrls.get(pageUrl);
      if (!target) continue;

      allRows.push({
        slug: target.slug,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Math.round(row.ctr * 10000) / 10000,
        position: Math.round(row.position * 10) / 10,
      });
    }

    if (rows.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
  }

  // For targets not found in GSC, return zeros
  for (const t of targets) {
    if (!allRows.some((r) => r.slug === t.slug)) {
      allRows.push({ slug: t.slug, clicks: 0, impressions: 0, ctr: 0, position: 0 });
    }
  }

  return allRows;
}

async function writeMetrics(targets: PageMetricTarget[], metrics: GscSlugMetric[]) {
  const metricsBySlug = new Map(metrics.map((m) => [m.slug, m]));

  let updated = 0;
  for (const target of targets) {
    const metric = metricsBySlug.get(target.slug);
    if (!metric) continue;

    // Skip pages with no impressions and already-populated search_volume
    if (metric.impressions === 0 && target.search_volume !== null) continue;

    const { error } = await supabase
      .from('pages')
      .update({
        search_volume: metric.impressions > 0 ? metric.impressions : (target.search_volume ?? 0),
        metadata: {
          gsc_clicks: metric.clicks,
          gsc_impressions: metric.impressions,
          gsc_ctr: metric.ctr,
          gsc_position: metric.position,
          gsc_synced_at: new Date().toISOString(),
        },
      })
      .eq('id', target.id);

    if (error) {
      console.error(`Failed to update metrics for ${target.slug}:`, error);
      continue;
    }

    updated += 1;
  }

  return updated;
}

async function run() {
  const targets = await loadMetricTargets();
  if (!targets.length) {
    console.log('No pages found for GSC sync.');
    return;
  }

  const metrics = await fetchSlugMetricsFromGsc(targets);
  const updated = await writeMetrics(targets, metrics);

  const liveMode = Boolean(process.env.GSC_SERVICE_ACCOUNT_JSON);
  console.log(
    `GSC sync complete (mode=${liveMode ? 'live' : 'placeholder'}). Processed ${targets.length} page(s), updated ${updated} row(s).`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
