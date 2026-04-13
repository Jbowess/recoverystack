/**
 * Backlink Monitoring
 *
 * Syncs new backlinks from Ahrefs API v3 (or Moz Link Explorer fallback).
 * Upserts into the backlinks table.
 * Sends a pipeline alert when high-DA (≥50) new referring domains are found.
 *
 * No-ops when no API keys are set.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sendPipelineAlert } from '@/lib/pipeline-alerts';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';
const HIGH_DA_THRESHOLD = 50;

interface BacklinkRow {
  referring_domain: string;
  referring_url: string;
  target_url: string;
  anchor_text: string | null;
  domain_rating: number | null;
  first_seen: string;
  last_seen: string;
  is_new: boolean;
  source: string;
}

async function fetchFromAhrefs(): Promise<BacklinkRow[]> {
  const apiKey = process.env.AHREFS_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL('https://api.ahrefs.com/v3/site-explorer/new-backlinks');
    url.searchParams.set('select', 'url_from,domain_rating_source,anchor,url_to,first_seen');
    url.searchParams.set('target', SITE_URL);
    url.searchParams.set('mode', 'subdomains');
    url.searchParams.set('limit', '100');
    url.searchParams.set('order_by', 'first_seen:desc');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[backlink-sync] Ahrefs error ${res.status}: ${await res.text()}`);
      return [];
    }

    const json = await res.json();
    const items = json?.backlinks ?? [];
    const today = new Date().toISOString().split('T')[0];

    return (items as Array<Record<string, unknown>>).map((item) => {
      const referringUrl = String(item.url_from ?? '');
      const domain = (() => {
        try { return new URL(referringUrl).hostname; } catch { return referringUrl; }
      })();
      return {
        referring_domain: domain,
        referring_url: referringUrl,
        target_url: String(item.url_to ?? SITE_URL),
        anchor_text: item.anchor ? String(item.anchor) : null,
        domain_rating: item.domain_rating_source != null ? Number(item.domain_rating_source) : null,
        first_seen: item.first_seen ? String(item.first_seen).split('T')[0] : today,
        last_seen: today,
        is_new: true,
        source: 'ahrefs',
      };
    });
  } catch (err) {
    console.warn('[backlink-sync] Ahrefs fetch error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function fetchFromMoz(): Promise<BacklinkRow[]> {
  const accessId = process.env.MOZ_ACCESS_ID;
  const secretKey = process.env.MOZ_SECRET_KEY;
  if (!accessId || !secretKey) return [];

  try {
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signingString = `${accessId}\n${expires}`;
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha1', secretKey).update(signingString).digest('base64');
    const token = Buffer.from(`${accessId}:${expires}:${signature}`).toString('base64');

    const res = await fetch('https://lsapi.seomoz.com/v2/links', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_scope: { scope: 'url', value: SITE_URL },
        target_scope: { scope: 'root_domain', value: SITE_URL },
        limit: 100,
        metrics: ['domain_authority', 'spam_score'],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[backlink-sync] Moz error ${res.status}: ${await res.text()}`);
      return [];
    }

    const json = await res.json();
    const results = json?.results ?? [];
    const today = new Date().toISOString().split('T')[0];

    return (results as Array<Record<string, unknown>>).map((item) => {
      const referringUrl = String(item.source_url ?? '');
      const domain = (() => {
        try { return new URL(referringUrl).hostname; } catch { return referringUrl; }
      })();
      return {
        referring_domain: domain,
        referring_url: referringUrl,
        target_url: String(item.target_url ?? SITE_URL),
        anchor_text: item.anchor_text ? String(item.anchor_text) : null,
        domain_rating: (item.metrics as Record<string, unknown>)?.domain_authority != null ? Number((item.metrics as Record<string, unknown>).domain_authority) : null,
        first_seen: today,
        last_seen: today,
        is_new: true,
        source: 'moz',
      };
    });
  } catch (err) {
    console.warn('[backlink-sync] Moz fetch error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function run() {
  if (!process.env.AHREFS_API_KEY && !process.env.MOZ_ACCESS_ID) {
    console.log('[backlink-sync] No API keys configured (AHREFS_API_KEY or MOZ_ACCESS_ID) — skipping.');
    return;
  }

  // Try Ahrefs first, fall back to Moz
  let backlinks = await fetchFromAhrefs();
  if (backlinks.length === 0) {
    backlinks = await fetchFromMoz();
  }

  if (backlinks.length === 0) {
    console.log('[backlink-sync] No new backlinks found.');
    return;
  }

  console.log(`[backlink-sync] Processing ${backlinks.length} backlink(s)...`);

  const { error } = await supabase
    .from('backlinks')
    .upsert(backlinks, { onConflict: 'referring_url' });

  if (error) {
    console.warn(`[backlink-sync] Upsert failed: ${error.message}`);
    return;
  }

  // Alert on high-DA new domains
  const highDaLinks = backlinks.filter((b) => b.domain_rating !== null && b.domain_rating >= HIGH_DA_THRESHOLD);
  if (highDaLinks.length > 0) {
    const domains = [...new Set(highDaLinks.map((b) => b.referring_domain))].join(', ');
    await sendPipelineAlert({
      pipeline: 'backlink-sync',
      status: 'warning',
      message: `${highDaLinks.length} high-DA (≥${HIGH_DA_THRESHOLD}) new referring domain(s) detected: ${domains}`,
      durationMs: 0,
    });
    console.log(`[backlink-sync] High-DA alert sent for: ${domains}`);
  }

  console.log(`[backlink-sync] Synced ${backlinks.length} backlink(s). High-DA: ${highDaLinks.length}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
