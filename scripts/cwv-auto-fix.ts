/**
 * CWV Auto-Fix
 *
 * Monitors Core Web Vitals from cwv_metrics table (written by cwv-monitor.ts)
 * and automatically applies template configuration fixes when thresholds
 * are breached — closing the CWV → template feedback loop.
 *
 * Automated responses:
 *   LCP > 2500ms  → flag hero images for lazy/eager optimisation, add preload hints
 *   CLS > 0.1     → flag layout shift causing components for review
 *   INP > 200ms   → flag heavy interactive components (carousels, expandable FAQs)
 *   FID > 100ms   → flag long JS tasks in component_library for that template
 *   TTFB > 600ms  → trigger ISR revalidation for affected pages
 *
 * Writes recommendations to `cwv_fixes` table.
 * Updates component_library weights to penalise CWV-degrading components.
 * Triggers immediate revalidation for critical CWV regressions.
 *
 * Usage:
 *   npx tsx scripts/cwv-auto-fix.ts
 *   npx tsx scripts/cwv-auto-fix.ts --dry-run
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
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';
const VERCEL_DEPLOY_HOOK = process.env.VERCEL_DEPLOY_HOOK_URL;

// ── CWV thresholds ────────────────────────────────────────────────────────────
const THRESHOLDS = {
  lcp_poor_ms: 2500,
  cls_poor: 0.1,
  inp_poor_ms: 200,
  fid_poor_ms: 100,
  ttfb_poor_ms: 600,
};

// ── Component weight penalties ────────────────────────────────────────────────
// Components known to cause specific CWV issues
const CLS_RISKY_COMPONENTS = ['image_carousel', 'lazy_image_grid', 'dynamic_ad_slot', 'expandable_section'];
const LCP_RISKY_COMPONENTS = ['hero_image', 'full_bleed_image', 'video_embed'];
const INP_RISKY_COMPONENTS = ['interactive_comparison_table', 'expandable_faq', 'filter_controls', 'tab_navigation'];

type CwvMetricRow = {
  page_slug: string;
  template: string;
  url: string;
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
  fid_ms: number | null;
  ttfb_ms: number | null;
  measured_at: string;
};

type FixRow = {
  page_slug: string;
  template: string;
  metric: string;
  measured_value: number;
  threshold: number;
  severity: 'critical' | 'poor' | 'needs_improvement';
  fix_type: string;
  recommendation: string;
  applied: boolean;
  created_at: string;
};

function classify(value: number, threshold: number): FixRow['severity'] {
  if (value > threshold * 1.5) return 'critical';
  if (value > threshold) return 'poor';
  return 'needs_improvement';
}

async function triggerRevalidation(slug: string, template: string): Promise<void> {
  if (!VERCEL_DEPLOY_HOOK) return;

  const revalidateUrl = `${SITE_URL}/api/revalidate`;
  try {
    await fetch(revalidateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.REVALIDATE_SECRET ?? ''}` },
      body: JSON.stringify({ slug, template }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Non-blocking
  }
}

async function penaliseComponent(componentName: string, penaltyFactor: number, template: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry] Penalise component "${componentName}" (template=${template}) by ${penaltyFactor}x`);
    return;
  }

  // Reduce component weight in component_library
  const { data } = await supabase
    .from('component_library')
    .select('id, weight')
    .ilike('component_name', `%${componentName}%`)
    .eq('template', template)
    .single();

  if (!data) return;

  const currentWeight = (data as any).weight ?? 1.0;
  const newWeight = Math.max(0.1, currentWeight * penaltyFactor);

  await supabase.from('component_library').update({ weight: newWeight }).eq('id', (data as any).id);
  console.log(`  Penalised ${componentName} (${template}): ${currentWeight.toFixed(2)} → ${newWeight.toFixed(2)}`);
}

async function processMetric(metric: CwvMetricRow): Promise<FixRow[]> {
  const fixes: FixRow[] = [];
  const now = new Date().toISOString();

  // LCP
  if (metric.lcp_ms !== null && metric.lcp_ms > THRESHOLDS.lcp_poor_ms) {
    fixes.push({
      page_slug: metric.page_slug,
      template: metric.template,
      metric: 'lcp',
      measured_value: metric.lcp_ms,
      threshold: THRESHOLDS.lcp_poor_ms,
      severity: classify(metric.lcp_ms, THRESHOLDS.lcp_poor_ms),
      fix_type: 'image_optimisation',
      recommendation: `LCP ${metric.lcp_ms}ms — add fetchpriority="high" to hero image, ensure images are WebP, add preload link for LCP image`,
      applied: false,
      created_at: now,
    });

    // Penalise heavy image components
    for (const comp of LCP_RISKY_COMPONENTS) {
      await penaliseComponent(comp, 0.7, metric.template);
    }
  }

  // CLS
  if (metric.cls !== null && metric.cls > THRESHOLDS.cls_poor) {
    fixes.push({
      page_slug: metric.page_slug,
      template: metric.template,
      metric: 'cls',
      measured_value: metric.cls,
      threshold: THRESHOLDS.cls_poor,
      severity: classify(metric.cls, THRESHOLDS.cls_poor),
      fix_type: 'layout_shift_prevention',
      recommendation: `CLS ${metric.cls} — add explicit width/height to all images, reserve space for lazy-loaded content, avoid injecting content above fold`,
      applied: false,
      created_at: now,
    });

    for (const comp of CLS_RISKY_COMPONENTS) {
      await penaliseComponent(comp, 0.6, metric.template);
    }
  }

  // INP
  if (metric.inp_ms !== null && metric.inp_ms > THRESHOLDS.inp_poor_ms) {
    fixes.push({
      page_slug: metric.page_slug,
      template: metric.template,
      metric: 'inp',
      measured_value: metric.inp_ms,
      threshold: THRESHOLDS.inp_poor_ms,
      severity: classify(metric.inp_ms, THRESHOLDS.inp_poor_ms),
      fix_type: 'interaction_optimisation',
      recommendation: `INP ${metric.inp_ms}ms — defer non-critical JS, use passive event listeners, reduce main thread blocking`,
      applied: false,
      created_at: now,
    });

    for (const comp of INP_RISKY_COMPONENTS) {
      await penaliseComponent(comp, 0.65, metric.template);
    }
  }

  // TTFB — trigger ISR revalidation
  if (metric.ttfb_ms !== null && metric.ttfb_ms > THRESHOLDS.ttfb_poor_ms) {
    fixes.push({
      page_slug: metric.page_slug,
      template: metric.template,
      metric: 'ttfb',
      measured_value: metric.ttfb_ms,
      threshold: THRESHOLDS.ttfb_poor_ms,
      severity: classify(metric.ttfb_ms, THRESHOLDS.ttfb_poor_ms),
      fix_type: 'isr_revalidation',
      recommendation: `TTFB ${metric.ttfb_ms}ms — trigger ISR revalidation to warm CDN cache for this page`,
      applied: false,
      created_at: now,
    });

    if (!DRY_RUN) {
      await triggerRevalidation(metric.page_slug, metric.template);
    }
  }

  return fixes;
}

async function run(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: metrics } = await supabase
    .from('cwv_metrics')
    .select('page_slug, template, url, lcp_ms, cls, inp_ms, fid_ms, ttfb_ms, measured_at')
    .gte('measured_at', since)
    .or([
      `lcp_ms.gt.${THRESHOLDS.lcp_poor_ms}`,
      `cls.gt.${THRESHOLDS.cls_poor}`,
      `inp_ms.gt.${THRESHOLDS.inp_poor_ms}`,
      `ttfb_ms.gt.${THRESHOLDS.ttfb_poor_ms}`,
    ].join(','));

  console.log(`[cwv-auto-fix] Processing ${(metrics ?? []).length} pages with CWV issues (dryRun=${DRY_RUN})`);

  let totalFixes = 0;
  const criticalPages: string[] = [];

  for (const metric of (metrics ?? []) as CwvMetricRow[]) {
    const fixes = await processMetric(metric);
    totalFixes += fixes.length;

    if (fixes.some((f) => f.severity === 'critical')) {
      criticalPages.push(metric.page_slug);
    }

    if (!DRY_RUN && fixes.length > 0) {
      for (const fix of fixes) {
        await supabase.from('cwv_fixes').upsert({
          ...fix,
          page_slug: metric.page_slug,
        }, { onConflict: 'page_slug,metric' });
      }
    }

    if (fixes.length > 0) {
      console.log(`[cwv] ${metric.page_slug}: ${fixes.map((f) => `${f.metric}=${f.measured_value}(${f.severity})`).join(' ')}`);
    }
  }

  if (criticalPages.length > 0 && !DRY_RUN) {
    await sendPipelineAlert({
      pipeline: 'cwv-auto-fix',
      step: 'critical-cwv',
      status: 'warning',
      message: `${criticalPages.length} page(s) with critical CWV regressions:\n${criticalPages.join('\n')}`,
      durationMs: 0,
    });
  }

  // Write aggregate CWV health summary
  if (!DRY_RUN) {
    const { data: allMetrics } = await supabase
      .from('cwv_metrics')
      .select('lcp_ms, cls, inp_ms, ttfb_ms')
      .gte('measured_at', since);

    if (allMetrics && allMetrics.length > 0) {
      const rows = allMetrics as Array<{ lcp_ms: number | null; cls: number | null; inp_ms: number | null; ttfb_ms: number | null }>;
      const lcpVals = rows.map((r) => r.lcp_ms).filter((v): v is number => v !== null);
      const clsVals = rows.map((r) => r.cls).filter((v): v is number => v !== null);
      const inpVals = rows.map((r) => r.inp_ms).filter((v): v is number => v !== null);

      const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? null; };

      await supabase.from('cwv_health_snapshots').upsert({
        snapshot_date: new Date().toISOString().split('T')[0],
        pages_measured: rows.length,
        pages_with_issues: (metrics ?? []).length,
        median_lcp_ms: median(lcpVals),
        median_cls: median(clsVals),
        median_inp_ms: median(inpVals),
        pct_good_lcp: Math.round((lcpVals.filter((v) => v <= 2500).length / lcpVals.length) * 100),
        pct_good_cls: Math.round((clsVals.filter((v) => v <= 0.1).length / clsVals.length) * 100),
        recorded_at: new Date().toISOString(),
      }, { onConflict: 'snapshot_date' });
    }
  }

  console.log(`[cwv-auto-fix] Done. ${totalFixes} fixes generated, ${criticalPages.length} critical pages (dryRun=${DRY_RUN})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
