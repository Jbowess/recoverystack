import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LOOKBACK_DAYS = Number(process.env.REPURPOSING_LEARNING_LOOKBACK_DAYS ?? 30);

type AssetRow = {
  id: string;
  channel: string;
  asset_type: string;
  payload: Record<string, unknown> | null;
};

type MetricRow = {
  asset_id: string;
  impressions: number | null;
  clicks: number | null;
  engagements: number | null;
  conversions: number | null;
};

type SocialMetricRow = {
  publication_queue_id: string | null;
  channel: string;
  impressions: number | null;
  clicks: number | null;
  engagements: number | null;
  conversions: number | null;
};

async function run() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [assetsResult, metricsResult, socialResult] = await Promise.all([
    supabase
      .from('distribution_assets')
      .select('id,channel,asset_type,payload')
      .limit(2000),
    supabase
      .from('distribution_asset_metrics')
      .select('asset_id,impressions,clicks,engagements,conversions')
      .gte('metric_date', since)
      .limit(4000),
    supabase
      .from('social_channel_metrics')
      .select('publication_queue_id,channel,impressions,clicks,engagements,conversions')
      .gte('metric_date', since)
      .limit(4000),
  ]);

  if (assetsResult.error?.message?.includes('distribution_assets')) {
    console.log('[repurposing-learning-rollup] distribution_assets missing - skipping.');
    return;
  }
  if (assetsResult.error) throw assetsResult.error;
  if (metricsResult.error?.message?.includes('distribution_asset_metrics')) {
    console.log('[repurposing-learning-rollup] distribution_asset_metrics missing - skipping.');
    return;
  }
  if (metricsResult.error) throw metricsResult.error;
  if (socialResult.error?.message?.includes('social_channel_metrics')) {
    console.log('[repurposing-learning-rollup] social_channel_metrics missing - partial mode.');
  } else if (socialResult.error) {
    throw socialResult.error;
  }

  const metricsByAsset = new Map<string, { impressions: number; clicks: number; engagements: number; conversions: number }>();
  for (const row of (metricsResult.data ?? []) as MetricRow[]) {
    const current = metricsByAsset.get(row.asset_id) ?? { impressions: 0, clicks: 0, engagements: 0, conversions: 0 };
    current.impressions += row.impressions ?? 0;
    current.clicks += row.clicks ?? 0;
    current.engagements += row.engagements ?? 0;
    current.conversions += row.conversions ?? 0;
    metricsByAsset.set(row.asset_id, current);
  }

  const socialByChannel = new Map<string, { impressions: number; clicks: number; engagements: number; conversions: number; samples: number }>();
  for (const row of (socialResult.data ?? []) as SocialMetricRow[]) {
    const current = socialByChannel.get(row.channel) ?? { impressions: 0, clicks: 0, engagements: 0, conversions: 0, samples: 0 };
    current.impressions += row.impressions ?? 0;
    current.clicks += row.clicks ?? 0;
    current.engagements += row.engagements ?? 0;
    current.conversions += row.conversions ?? 0;
    current.samples += 1;
    socialByChannel.set(row.channel, current);
  }

  const buckets = new Map<string, {
    channel: string;
    asset_type: string;
    hook_pattern: string | null;
    persona: string | null;
    angle_type: string | null;
    evidence_type: string | null;
    sample_size: number;
    impressions: number;
    clicks: number;
    engagements: number;
    conversions: number;
    reachScoreSum: number;
  }>();

  for (const asset of (assetsResult.data ?? []) as AssetRow[]) {
    const metrics = metricsByAsset.get(asset.id) ?? { impressions: 0, clicks: 0, engagements: 0, conversions: 0 };
    const payload = asset.payload ?? {};
    const hookPattern = typeof payload.hook_pattern === 'string' ? payload.hook_pattern : null;
    const persona = typeof payload.audience_segment === 'string' ? payload.audience_segment : null;
    const angleType = typeof payload.angle_type === 'string' ? payload.angle_type : null;
    const evidenceType = typeof payload.evidence_type === 'string' ? payload.evidence_type : null;
    const predictedReach = typeof payload.reach_score === 'number' ? Number(payload.reach_score) : 0;
    const key = [asset.channel, asset.asset_type, hookPattern ?? '', persona ?? '', angleType ?? '', evidenceType ?? ''].join('|');
    const bucket = buckets.get(key) ?? {
      channel: asset.channel,
      asset_type: asset.asset_type,
      hook_pattern: hookPattern,
      persona,
      angle_type: angleType,
      evidence_type: evidenceType,
      sample_size: 0,
      impressions: 0,
      clicks: 0,
      engagements: 0,
      conversions: 0,
      reachScoreSum: 0,
    };

    bucket.sample_size += 1;
    bucket.impressions += metrics.impressions;
    bucket.clicks += metrics.clicks;
    bucket.engagements += metrics.engagements;
    bucket.conversions += metrics.conversions;
    bucket.reachScoreSum += predictedReach;
    buckets.set(key, bucket);
  }

  const learnedOn = new Date().toISOString().slice(0, 10);
  const rows = [...buckets.values()].map((bucket) => {
    const socialLift = socialByChannel.get(bucket.channel);
    const sampleSize = Math.max(bucket.sample_size, 1);
    return {
      learned_on: learnedOn,
      channel: bucket.channel,
      asset_type: bucket.asset_type,
      hook_pattern: bucket.hook_pattern,
      persona: bucket.persona,
      angle_type: bucket.angle_type,
      evidence_type: bucket.evidence_type,
      sample_size: bucket.sample_size,
      avg_impressions: Number((bucket.impressions / sampleSize).toFixed(2)),
      avg_clicks: Number((bucket.clicks / sampleSize).toFixed(2)),
      avg_engagements: Number((bucket.engagements / sampleSize).toFixed(2)),
      avg_conversions: Number((bucket.conversions / sampleSize).toFixed(2)),
      avg_reach_score: Number((bucket.reachScoreSum / sampleSize).toFixed(2)),
      metadata: {
        social_channel_baseline: socialLift
          ? {
              impressions: Number((socialLift.impressions / Math.max(socialLift.samples, 1)).toFixed(2)),
              clicks: Number((socialLift.clicks / Math.max(socialLift.samples, 1)).toFixed(2)),
              engagements: Number((socialLift.engagements / Math.max(socialLift.samples, 1)).toFixed(2)),
              conversions: Number((socialLift.conversions / Math.max(socialLift.samples, 1)).toFixed(2)),
            }
          : null,
      },
    };
  });

  if (DRY_RUN) {
    console.log(`[repurposing-learning-rollup] rows=${rows.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('asset_performance_learning').upsert(rows, {
    onConflict: 'learned_on,channel,asset_type,hook_pattern,persona,angle_type,evidence_type',
  } as never);

  if (error?.message?.includes('asset_performance_learning')) {
    console.log('[repurposing-learning-rollup] asset_performance_learning missing - skipping persistence.');
    return;
  }
  if (error) throw error;

  console.log(`[repurposing-learning-rollup] rows=${rows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
