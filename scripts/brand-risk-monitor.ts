import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function severityFor(score: number) {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

async function run() {
  const [pagesResult, originalityResult, communityResult] = await Promise.all([
    supabase.from('pages').select('slug,originality_score,last_verified_at,metadata').eq('status', 'published').limit(300),
    supabase.from('page_originality_scores').select('page_slug,total_score,status,breakdown').order('created_at', { ascending: false }).limit(300),
    supabase.from('community_topic_mentions').select('topic_slug,sentiment,mention_count,title').limit(300),
  ]);

  const pages = pagesResult.error ? [] : (pagesResult.data ?? []);
  const originality = originalityResult.error?.message?.includes('page_originality_scores') ? [] : (originalityResult.data ?? []);
  const community = communityResult.error?.message?.includes('community_topic_mentions') ? [] : (communityResult.data ?? []);

  const alerts: any[] = [];
  for (const page of pages as any[]) {
    if (typeof page.originality_score === 'number' && page.originality_score < 60) {
      const sev = severityFor(100 - page.originality_score);
      alerts.push({
        alert_key: `originality:${page.slug}`,
        risk_type: 'originality_decay',
        severity: sev,
        page_slug: page.slug,
        source_key: page.slug,
        summary: `Originality score dropped to ${page.originality_score} for ${page.slug}.`,
        status: 'open',
        metadata: { originality_score: page.originality_score },
      });
    }
    const lastVerified = typeof page.last_verified_at === 'string' ? new Date(page.last_verified_at) : null;
    const ageDays = lastVerified ? Math.round((Date.now() - lastVerified.getTime()) / 86_400_000) : 999;
    if (ageDays > 45) {
      alerts.push({
        alert_key: `staleness:${page.slug}`,
        risk_type: 'staleness',
        severity: severityFor(Math.min(100, ageDays)),
        page_slug: page.slug,
        source_key: page.slug,
        summary: `${page.slug} has not been verified for ${ageDays} days.`,
        status: 'open',
        metadata: { age_days: ageDays },
      });
    }
    const claimStatus = String(page.metadata?.claim_verification_status ?? '');
    if (claimStatus === 'mixed') {
      alerts.push({
        alert_key: `claim-risk:${page.slug}`,
        risk_type: 'claim_risk',
        severity: 'high',
        page_slug: page.slug,
        source_key: page.slug,
        summary: `${page.slug} has mixed claim verification status.`,
        status: 'open',
        metadata: { claim_verification_status: claimStatus },
      });
    }
  }

  for (const row of community as any[]) {
    if (String(row.sentiment ?? '') === 'negative' && Number(row.mention_count ?? 0) >= 3) {
      alerts.push({
        alert_key: `community:${row.topic_slug}:${String(row.title ?? row.topic_slug).slice(0, 40)}`,
        risk_type: 'negative_sentiment',
        severity: severityFor(Number(row.mention_count ?? 0) * 10),
        page_slug: null,
        source_key: row.topic_slug,
        summary: `Negative community sentiment cluster detected for ${row.topic_slug}.`,
        status: 'open',
        metadata: { mention_count: row.mention_count, title: row.title ?? null },
      });
    }
  }

  if (DRY_RUN) {
    console.log(`[brand-risk-monitor] alerts=${alerts.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('brand_risk_alerts').upsert(alerts, { onConflict: 'alert_key' });
  if (error?.message?.includes('brand_risk_alerts')) {
    console.log('[brand-risk-monitor] brand_risk_alerts missing - skipping persistence.');
    return;
  }
  if (error) throw error;
  console.log(`[brand-risk-monitor] alerts=${alerts.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
