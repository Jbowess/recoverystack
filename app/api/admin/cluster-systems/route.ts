import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { buildClusterName, normalizeKeyword } from '@/lib/seo-keywords';

type ComponentSeed = {
  cluster: 'intro_hook' | 'verdict_style' | 'newsletter_offer' | 'layout_pattern';
  name: string;
  snippet: string;
  weight: number;
  tags: string[];
  layout_json?: unknown;
};

const COMPONENT_LIBRARY_SEED: ComponentSeed[] = [
  {
    cluster: 'intro_hook',
    name: 'A-urgent-recovery-angle',
    snippet:
      'If {{Primary_Keyword}} is slowing your RecoveryStack workflow, this breakdown shows where Volo shifts the recovery bottleneck and where legacy options still win.',
    weight: 1.15,
    tags: ['A', 'volo', 'urgent', 'conversion'],
  },
  {
    cluster: 'intro_hook',
    name: 'B-trust-builder-angle',
    snippet:
      'RecoveryStack teams comparing {{Primary_Keyword}} usually care about proof, not hype. We mapped real Volo tradeoffs so you can choose with confidence.',
    weight: 1,
    tags: ['B', 'volo', 'authority', 'trust'],
  },
  {
    cluster: 'verdict_style',
    name: 'A-direct-verdict',
    snippet:
      'Verdict: choose Volo when {{Primary_Keyword}} needs faster deployment and tighter RecoveryStack alignment; skip it if your stack depends on deep legacy integrations first.',
    weight: 1.1,
    tags: ['A', 'verdict', 'direct'],
  },
  {
    cluster: 'newsletter_offer',
    name: 'A-weekly-playbook',
    snippet:
      'Want more than a one-off {{Primary_Keyword}} comparison? Join the RecoveryStack weekly Volo playbook for fresh benchmarks, migration templates, and teardown notes.',
    weight: 1,
    tags: ['A', 'newsletter', 'playbook'],
  },
  {
    cluster: 'layout_pattern',
    name: 'layout-pattern-A-comparison-first',
    snippet: 'Comparison-led layout: quick verdict, scorecard, then implementation path.',
    weight: 1.1,
    tags: ['A', 'layout', 'comparison'],
    layout_json: [
      { block: 'hero', variant: 'sharp_verdict' },
      { block: 'comparison_table', variant: 'feature_delta' },
      { block: 'pros_cons', variant: 'balanced' },
      { block: 'implementation_steps', variant: '30_60_90' },
      { block: 'faq', variant: 'buyer_objections' },
      { block: 'cta', variant: 'newsletter_offer' },
    ],
  },
];

function getTrendScore(row: any) {
  const candidates = [row?.trend_score, row?.score, row?.priority, row?.search_volume];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

async function reseedComponentLibrary() {
  const payload = COMPONENT_LIBRARY_SEED.map((row) => ({
    ...row,
    active: true,
  }));

  const { error } = await supabaseAdmin.from('component_library').upsert(payload, {
    onConflict: 'cluster,name',
  });

  if (error) throw error;
}

async function enqueueTopTrends(limit: number) {
  const { data: trends, error: trendError } = await supabaseAdmin
    .from('trends')
    .select('id,term,normalized_term,source,status,created_at,last_seen_at,trend_score,score,priority,search_volume')
    .in('status', ['new', 'queued'])
    .order('trend_score', { ascending: false, nullsFirst: false })
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (trendError) throw trendError;

  const sorted = (trends ?? [])
    .slice()
    .sort((a: any, b: any) => getTrendScore(b) - getTrendScore(a))
    .filter((row: any) => typeof row.term === 'string' && row.term.trim().length > 0)
    .slice(0, Math.max(1, Math.min(limit, 100)));

  const keywords = sorted.map((row: any) => row.term.trim());
  if (!keywords.length) return;

  const normalizedKeywords = sorted.map((row: any) => normalizeKeyword(String(row.normalized_term ?? row.term ?? '')));
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('keyword_queue')
    .select('normalized_keyword')
    .in('normalized_keyword', normalizedKeywords);
  if (existingError) throw existingError;

  const existing = new Set(
    (existingRows ?? [])
      .map((row: any) => normalizeKeyword(String(row.normalized_keyword ?? '')))
      .filter(Boolean),
  );
  const toInsert = sorted
    .filter((row: any) => !existing.has(normalizeKeyword(String(row.normalized_term ?? row.term ?? ''))))
    .map((row: any) => ({
      cluster_name: buildClusterName(String(row.term ?? 'trend')),
      primary_keyword: row.term,
      normalized_keyword: normalizeKeyword(String(row.normalized_term ?? row.term ?? '')),
      template_id: 'trends',
      source: 'trend',
      status: 'queued',
      priority: getTrendScore(row) || 50,
      score: (getTrendScore(row) || 0) / 100,
      metadata: {
        trend_id: row.id,
        imported_from: 'admin_enqueue_top_trends',
        search_volume: row.search_volume ?? null,
      },
    }));

  if (!toInsert.length) return;

  const { error: insertError } = await supabaseAdmin
    .from('keyword_queue')
    .upsert(toInsert, { onConflict: 'cluster_name,primary_keyword' });
  if (insertError) throw insertError;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');

  try {
    if (action === 'reseed_component_library') {
      await reseedComponentLibrary();
      await logAdminAction({ action: 'reseed_component_library', metadata: { seed_count: COMPONENT_LIBRARY_SEED.length } });
      return NextResponse.redirect(new URL('/admin?ok=component_library_reseeded', req.url), { status: 302 });
    }

    if (action === 'enqueue_top_trends') {
      const requestedLimit = Number(form.get('limit') ?? 25);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 25;
      await enqueueTopTrends(limit);
      await logAdminAction({ action: 'enqueue_trends', metadata: { limit } });
      return NextResponse.redirect(new URL('/admin?ok=keyword_queue_seeded', req.url), { status: 302 });
    }

    return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
  } catch (error: any) {
    const message = encodeURIComponent(String(error?.message ?? 'unknown_error'));
    const key = action === 'reseed_component_library' ? 'component_library_reseed_failed' : 'keyword_queue_seed_failed';
    return NextResponse.redirect(new URL(`/admin?error=${key}&detail=${message}`, req.url), { status: 302 });
  }
}
