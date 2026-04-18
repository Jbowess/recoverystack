/**
 * Competitor Alert
 *
 * Detects when competitors publish new pages on our target keywords or
 * significantly improve their position — triggering content urgency signals.
 *
 * Detection methods:
 *   1. New competitor pages — URLs in competitor_page_analyses not seen before
 *   2. Position gains — competitor moved from position 6+ to 1-3 for our keyword
 *   3. Competitor freshness — competitor page updated more recently than ours
 *   4. Content length surge — competitor significantly expanded word count
 *
 * Outputs:
 *   - `competitor_alerts` table with severity + recommended action
 *   - Enqueues affected pages to content_refresh_queue
 *   - Sends pipeline alert for critical threats
 *
 * Usage:
 *   npx tsx scripts/competitor-alert.ts
 *   npx tsx scripts/competitor-alert.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sendPipelineAlert } from '@/lib/pipeline-alerts';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const ALERT_POSITION_GAIN = Number(process.env.ALERT_COMPETITOR_POSITION_GAIN ?? 3);
const ALERT_WORD_COUNT_SURGE_PCT = Number(process.env.ALERT_WORD_COUNT_SURGE ?? 40);

type AlertRow = {
  alert_key: string;
  keyword: string;
  page_slug: string | null;
  competitor_domain: string;
  competitor_url: string;
  alert_type: 'new_competitor_page' | 'position_gain' | 'content_surge' | 'freshness_advantage';
  severity: 'critical' | 'high' | 'medium' | 'low';
  details: Record<string, unknown>;
  recommended_action: string;
  status: 'new' | 'acknowledged' | 'actioned';
  detected_at: string;
};

function buildAlertKey(keyword: string, competitorDomain: string, alertType: string): string {
  return `${keyword.slice(0, 30)}:${competitorDomain}:${alertType}`.replace(/\s+/g, '_').toLowerCase();
}

// ── Detect new competitor pages ───────────────────────────────────────────────
async function detectNewCompetitorPages(): Promise<AlertRow[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data } = await supabase
    .from('competitor_page_analyses')
    .select('keyword, competitor_url, competitor_domain, word_count, fetched_at')
    .gte('fetched_at', since);

  if (!data) return [];

  const alerts: AlertRow[] = [];

  for (const row of data as Array<{ keyword: string; competitor_url: string; competitor_domain: string; word_count: number; fetched_at: string }>) {
    // Check if we have a page for this keyword
    const { data: ourPage } = await supabase
      .from('pages')
      .select('slug')
      .or(`primary_keyword.ilike.%${row.keyword}%,slug.ilike.%${row.keyword.split(' ').join('-')}%`)
      .limit(1)
      .single();

    // Only alert if competitor entered for a keyword where we have content
    if (!ourPage) continue;

    const alertKey = buildAlertKey(row.keyword, row.competitor_domain, 'new_competitor_page');

    // Check if we already have this alert
    const { data: existing } = await supabase
      .from('competitor_alerts')
      .select('id')
      .eq('alert_key', alertKey)
      .gte('detected_at', since)
      .limit(1);

    if ((existing ?? []).length > 0) continue;

    alerts.push({
      alert_key: alertKey,
      keyword: row.keyword,
      page_slug: (ourPage as any).slug ?? null,
      competitor_domain: row.competitor_domain,
      competitor_url: row.competitor_url,
      alert_type: 'new_competitor_page',
      severity: row.word_count > 3000 ? 'high' : 'medium',
      details: {
        competitor_word_count: row.word_count,
        detected_date: row.fetched_at,
      },
      recommended_action: `Review and update content for "${row.keyword}" — competitor ${row.competitor_domain} published new page (${row.word_count}w)`,
      status: 'new',
      detected_at: new Date().toISOString(),
    });
  }

  return alerts;
}

// ── Detect competitor position gains ─────────────────────────────────────────
async function detectPositionGains(): Promise<AlertRow[]> {
  // Get rank history for competitors (non-our-pages)
  const { data: rankData } = await supabase
    .from('rank_history')
    .select('keyword, ranking_url, position, is_our_page, checked_at')
    .eq('is_our_page', false)
    .lte('position', 5)
    .gte('checked_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
    .limit(500);

  const alerts: AlertRow[] = [];

  for (const rank of (rankData ?? []) as Array<{ keyword: string; ranking_url: string | null; position: number; checked_at: string }>) {
    if (!rank.ranking_url) continue;

    let domain: string;
    try { domain = new URL(rank.ranking_url).hostname.replace(/^www\./, ''); } catch { continue; }

    // Check if this keyword is one of ours
    const { data: ourPage } = await supabase
      .from('pages')
      .select('slug, metadata')
      .or(`primary_keyword.ilike.%${rank.keyword}%`)
      .limit(1)
      .single();

    if (!ourPage) continue;

    const ourPosition = ((ourPage as any).metadata?.current_position as number | null) ?? null;
    if (!ourPosition || ourPosition <= rank.position) continue; // We're still ahead or no data

    // Check if this competitor jumped significantly
    const { data: previousRank } = await supabase
      .from('rank_history')
      .select('position')
      .eq('keyword', rank.keyword)
      .ilike('ranking_url', `%${domain}%`)
      .lte('checked_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('checked_at', { ascending: false })
      .limit(1)
      .single();

    const prevPosition = (previousRank as any)?.position as number | null;
    if (!prevPosition) continue;

    const gain = prevPosition - rank.position;
    if (gain < ALERT_POSITION_GAIN) continue;

    const alertKey = buildAlertKey(rank.keyword, domain, 'position_gain');

    alerts.push({
      alert_key: alertKey,
      keyword: rank.keyword,
      page_slug: (ourPage as any).slug ?? null,
      competitor_domain: domain,
      competitor_url: rank.ranking_url,
      alert_type: 'position_gain',
      severity: rank.position <= 3 ? 'critical' : 'high',
      details: {
        prev_position: prevPosition,
        new_position: rank.position,
        position_gain: gain,
        our_position: ourPosition,
      },
      recommended_action: `Competitor ${domain} jumped ${gain} positions for "${rank.keyword}" (now pos ${rank.position}) — content update needed`,
      status: 'new',
      detected_at: new Date().toISOString(),
    });
  }

  return alerts;
}

// ── Detect content surges ─────────────────────────────────────────────────────
async function detectContentSurges(): Promise<AlertRow[]> {
  const { data } = await supabase
    .from('competitor_page_analyses')
    .select('keyword, competitor_domain, competitor_url, word_count, fetched_at')
    .gte('fetched_at', new Date(Date.now() - 3 * 86_400_000).toISOString())
    .gte('word_count', 2000);

  const alerts: AlertRow[] = [];

  for (const row of (data ?? []) as Array<{ keyword: string; competitor_domain: string; competitor_url: string; word_count: number }>) {
    // Find our page word count for comparison
    const { data: ourPage } = await supabase
      .from('pages')
      .select('slug, metadata')
      .or(`primary_keyword.ilike.%${row.keyword}%`)
      .limit(1)
      .single();

    if (!ourPage) continue;

    const ourWordCount = ((ourPage as any).metadata?.word_count as number | null) ?? 0;
    if (ourWordCount === 0) continue;

    const surgePct = ((row.word_count - ourWordCount) / ourWordCount) * 100;
    if (surgePct < ALERT_WORD_COUNT_SURGE_PCT) continue;

    const alertKey = buildAlertKey(row.keyword, row.competitor_domain, 'content_surge');

    alerts.push({
      alert_key: alertKey,
      keyword: row.keyword,
      page_slug: (ourPage as any).slug ?? null,
      competitor_domain: row.competitor_domain,
      competitor_url: row.competitor_url,
      alert_type: 'content_surge',
      severity: surgePct > 80 ? 'high' : 'medium',
      details: {
        competitor_word_count: row.word_count,
        our_word_count: ourWordCount,
        surge_pct: Math.round(surgePct),
      },
      recommended_action: `${row.competitor_domain} outpublishes us by ${Math.round(surgePct)}% on "${row.keyword}" — expand content`,
      status: 'new',
      detected_at: new Date().toISOString(),
    });
  }

  return alerts;
}

async function run(): Promise<void> {
  console.log(`[competitor-alert] Running detection (dryRun=${DRY_RUN})`);

  const [newPages, positionGains, contentSurges] = await Promise.all([
    detectNewCompetitorPages(),
    detectPositionGains(),
    detectContentSurges(),
  ]);

  const allAlerts = [...newPages, ...positionGains, ...contentSurges]
    .sort((a, b) => {
      const sev = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sev[b.severity] ?? 0) - (sev[a.severity] ?? 0);
    });

  console.log(`[competitor-alert] ${allAlerts.length} alerts: ${newPages.length} new pages, ${positionGains.length} position gains, ${contentSurges.length} content surges`);

  const criticalAlerts = allAlerts.filter((a) => a.severity === 'critical');

  for (const alert of allAlerts) {
    const icon = alert.severity === 'critical' ? '🚨' : alert.severity === 'high' ? '⚠️' : '📊';
    console.log(`  ${icon} [${alert.severity.toUpperCase()}] ${alert.keyword}: ${alert.competitor_domain} — ${alert.alert_type}`);
    console.log(`     ${alert.recommended_action}`);
  }

  if (!DRY_RUN) {
    for (const alert of allAlerts) {
      await supabase.from('competitor_alerts').upsert(alert, { onConflict: 'alert_key' });

      // Enqueue affected pages for refresh
      if ((alert.severity === 'critical' || alert.severity === 'high') && alert.page_slug) {
        await supabase.from('content_refresh_queue').upsert({
          page_slug: alert.page_slug,
          reason: `competitor_alert:${alert.alert_type}:${alert.competitor_domain}`,
          priority: alert.severity === 'critical' ? 'high' : 'medium',
          auto_approve: false,
          created_at: new Date().toISOString(),
        }, { onConflict: 'page_slug' });
      }
    }

    // Send pipeline alert for critical threats
    if (criticalAlerts.length > 0) {
      await sendPipelineAlert({
        pipeline: 'competitor-alert',
        step: 'critical-threats',
        status: 'warning',
        message: `${criticalAlerts.length} critical competitor threat(s):\n${criticalAlerts.map((a) => `  • ${a.recommended_action}`).join('\n')}`,
        durationMs: 0,
      });
    }
  }

  console.log('[competitor-alert] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
