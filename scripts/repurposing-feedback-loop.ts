import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildClusterName, normalizeKeyword, toLegacyCompatibleQueueTemplateId } from '@/lib/seo-keywords';
import type { TemplateType } from '@/lib/types';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LOOKBACK_DAYS = Number(process.env.REPURPOSING_FEEDBACK_LOOKBACK_DAYS ?? 30);
const LIMIT = Number(process.env.REPURPOSING_FEEDBACK_LIMIT ?? 40);

type AssetRow = {
  id: string;
  page_id: string | null;
  page_slug: string;
  channel: string;
  asset_type: string;
  title: string | null;
  hook: string | null;
  payload: Record<string, unknown> | null;
};

type MetricRow = {
  asset_id: string;
  clicks: number | null;
  engagements: number | null;
  conversions: number | null;
};

type PageRow = {
  id: string;
  slug: string;
  title: string;
  template: TemplateType;
  primary_keyword: string | null;
};

type BriefRow = {
  page_slug: string;
  keyword: string;
  required_subtopics: string[];
  competitor_weaknesses: string[];
};

function trimTitleCandidate(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 65);
}

function sanitizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhrase(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function chooseTemplate(page: PageRow, claimType: string | null): TemplateType {
  if (claimType === 'cost') return 'costs';
  if (claimType === 'accuracy') return 'metrics';
  if (claimType === 'compatibility') return 'compatibility';
  if (claimType === 'decision' || claimType === 'objection') return 'alternatives';
  return page.template;
}

function buildKeywordCandidate(page: PageRow, payload: Record<string, unknown> | null): string | null {
  const base = normalizePhrase(page.primary_keyword ?? page.title);
  const persona = typeof payload?.persona === 'string' ? payload.persona : null;
  const claimType = typeof payload?.claim_type === 'string' ? payload.claim_type : null;

  if (!base) return null;

  if (base.includes('oura') || base.includes('ringconn') || base.includes('ultrahuman') || base.includes('galaxy ring') || base.includes('volo ring')) {
    if (claimType === 'cost') return `${base} subscription cost`;
    if (claimType === 'accuracy') return `${base} accuracy`;
    if (claimType === 'compatibility') return `${base} compatibility`;
    return `${base} alternatives`;
  }

  if (persona === 'runners') return 'best smart ring for runners';
  if (persona === 'lifters') return 'best smart ring for strength training';
  if (persona === 'sleep_buyers') return 'best smart ring for sleep tracking';
  if (persona === 'subscription_averse') return 'best smart ring without subscription';
  if (persona === 'accuracy_first') return 'smart ring accuracy';
  if (persona === 'iphone_buyers') return 'smart ring iphone compatibility';
  if (persona === 'android_buyers') return 'smart ring android compatibility';
  if (persona === 'womens_health') return 'smart ring for women health tracking';

  if (claimType === 'cost') return 'smart ring cost comparison';
  if (claimType === 'accuracy') return 'smart ring hrv accuracy';
  if (claimType === 'compatibility') return 'smart ring compatibility';
  if (claimType === 'decision') return 'best smart ring';

  return null;
}

function buildTitleCandidate(asset: AssetRow) {
  const hook = sanitizeText(asset.hook);
  const title = sanitizeText(asset.title);
  const payloadHook = typeof asset.payload?.hook === 'string' ? sanitizeText(asset.payload.hook) : '';
  const candidate = hook || payloadHook || title;
  if (!candidate) return null;
  return trimTitleCandidate(candidate);
}

async function run() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [assetsResult, metricsResult, pagesResult, briefsResult] = await Promise.all([
    supabase
      .from('distribution_assets')
      .select('id,page_id,page_slug,channel,asset_type,title,hook,payload')
      .limit(500),
    supabase
      .from('distribution_asset_metrics')
      .select('asset_id,clicks,engagements,conversions')
      .gte('metric_date', since)
      .limit(2000),
    supabase
      .from('pages')
      .select('id,slug,title,template,primary_keyword')
      .in('status', ['draft', 'approved', 'published'])
      .limit(500),
    supabase
      .from('briefs')
      .select('page_slug,keyword,required_subtopics,competitor_weaknesses')
      .limit(500),
  ]);

  if (assetsResult.error?.message?.includes('distribution_assets')) {
    console.log('[repurposing-feedback-loop] distribution_assets missing - skipping.');
    return;
  }
  if (assetsResult.error) throw assetsResult.error;
  if (metricsResult.error?.message?.includes('distribution_asset_metrics')) {
    console.log('[repurposing-feedback-loop] distribution_asset_metrics missing - skipping.');
    return;
  }
  if (metricsResult.error) throw metricsResult.error;
  if (pagesResult.error) throw pagesResult.error;
  if (briefsResult.error?.message?.includes('briefs')) {
    console.log('[repurposing-feedback-loop] briefs missing - partial mode.');
  } else if (briefsResult.error) {
    throw briefsResult.error;
  }

  const metricsByAsset = new Map<string, { clicks: number; engagements: number; conversions: number }>();
  for (const row of (metricsResult.data ?? []) as MetricRow[]) {
    const existing = metricsByAsset.get(row.asset_id) ?? { clicks: 0, engagements: 0, conversions: 0 };
    existing.clicks += row.clicks ?? 0;
    existing.engagements += row.engagements ?? 0;
    existing.conversions += row.conversions ?? 0;
    metricsByAsset.set(row.asset_id, existing);
  }

  const pagesBySlug = new Map((pagesResult.data ?? []).map((row) => [String((row as PageRow).slug), row as PageRow]));
  const briefsBySlug = new Map((briefsResult.data ?? []).map((row) => [String((row as BriefRow).page_slug), row as BriefRow]));

  const rankedAssets = ((assetsResult.data ?? []) as AssetRow[])
    .map((asset) => {
      const metrics = metricsByAsset.get(asset.id) ?? { clicks: 0, engagements: 0, conversions: 0 };
      const score = metrics.clicks + metrics.engagements + (metrics.conversions * 10);
      return { asset, metrics, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);

  let titleSuggestions = 0;
  let keywordSuggestions = 0;
  let briefUpdates = 0;

  for (const winner of rankedAssets) {
    const page = pagesBySlug.get(winner.asset.page_slug);
    if (!page) continue;

    const claimType = typeof winner.asset.payload?.claim_type === 'string' ? winner.asset.payload.claim_type : null;
    const angleType = typeof winner.asset.payload?.angle_type === 'string' ? winner.asset.payload.angle_type : null;
    const recurringSeries = typeof winner.asset.payload?.recurring_series === 'string' ? winner.asset.payload.recurring_series : null;

    const titleCandidate = buildTitleCandidate(winner.asset);
    if (titleCandidate && winner.metrics.clicks >= 3) {
      titleSuggestions += 1;
      if (!DRY_RUN) {
        await supabase.from('page_title_experiments').upsert({
          page_id: page.id,
          page_slug: page.slug,
          channel: 'organic_search',
          variant: `repurpose-${winner.asset.channel}-${winner.asset.asset_type}`.slice(0, 48),
          title: titleCandidate,
          score: winner.score,
          status: 'suggested',
          reason: `Repurposing winner via ${winner.asset.channel}/${winner.asset.asset_type}`,
          metrics: {
            repurposing_score: winner.score,
            clicks: winner.metrics.clicks,
            engagements: winner.metrics.engagements,
            conversions: winner.metrics.conversions,
            angle_type: angleType,
          },
        }, {
          onConflict: 'page_id,channel,variant',
        } as never);
      }
    }

    const keywordCandidate = buildKeywordCandidate(page, winner.asset.payload);
    if (keywordCandidate) {
      keywordSuggestions += 1;
      if (!DRY_RUN) {
        await supabase.from('keyword_queue').upsert({
          cluster_name: buildClusterName(`${page.slug}-repurposing-feedback`),
          primary_keyword: keywordCandidate,
          normalized_keyword: normalizeKeyword(keywordCandidate),
          template_id: toLegacyCompatibleQueueTemplateId(chooseTemplate(page, claimType)),
          source: 'related_search',
          status: 'new',
          priority: Math.min(99, 60 + winner.score),
          score: Math.min(0.99, winner.score / 100),
          metadata: {
            source_page_slug: page.slug,
            source_asset_channel: winner.asset.channel,
            source_asset_type: winner.asset.asset_type,
            angle_type: angleType,
            recurring_series: recurringSeries,
            repurposing_feedback: true,
          },
        }, {
          onConflict: 'cluster_name,primary_keyword',
        });
      }
    }

    const brief = briefsBySlug.get(page.slug);
    if (brief) {
      const suggestedSubtopics = [
        angleType ? angleType.replace(/_/g, ' ') : '',
        recurringSeries ? recurringSeries.replace(/_/g, ' ') : '',
        typeof winner.asset.payload?.proof_point === 'string' ? winner.asset.payload.proof_point : '',
      ].map((item) => sanitizeText(item)).filter(Boolean);

      const weaknesses = [
        typeof winner.asset.payload?.strongest_objection === 'string' ? winner.asset.payload.strongest_objection : '',
        typeof winner.asset.payload?.evidence_type === 'string' ? `Need stronger ${winner.asset.payload.evidence_type} proof` : '',
      ].map((item) => sanitizeText(item)).filter(Boolean);

      const nextSubtopics = Array.from(new Set([...(brief.required_subtopics ?? []), ...suggestedSubtopics])).slice(0, 20);
      const nextWeaknesses = Array.from(new Set([...(brief.competitor_weaknesses ?? []), ...weaknesses])).slice(0, 20);

      briefUpdates += 1;
      if (!DRY_RUN) {
        await supabase.from('briefs').update({
          required_subtopics: nextSubtopics,
          competitor_weaknesses: nextWeaknesses,
        }).eq('page_slug', page.slug);
      }
    }
  }

  console.log(`[repurposing-feedback-loop] winners=${rankedAssets.length} titleSuggestions=${titleSuggestions} keywordSuggestions=${keywordSuggestions} briefUpdates=${briefUpdates} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
