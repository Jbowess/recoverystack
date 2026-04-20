import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { DistributionChannel } from '@/lib/distribution-engine';
import { buildPublicationQueueRecord, type DistributionAssetRow } from '@/lib/growth-engine';
import { getFreeApiChannels, getReachGoalForChannel, isFreeApiChannel } from '@/lib/free-distribution-policy';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LOOKBACK_LIMIT = Number(process.env.REACH_AMPLIFIER_LOOKBACK_LIMIT ?? 180);
const WINNER_LIMIT = Number(process.env.REACH_AMPLIFIER_WINNER_LIMIT ?? 24);
const MIN_WINNER_SCORE = Number(process.env.REACH_AMPLIFIER_MIN_SCORE ?? 72);
const allowedChannels = new Set(getFreeApiChannels());

type AssetMetricRow = DistributionAssetRow & {
  status?: string | null;
  payload?: Record<string, unknown> | null;
};

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function trim(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min = 0, max = 99) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function buildWinnerScore(asset: AssetMetricRow) {
  const payload = asset.payload ?? {};
  const reach = Number(payload.reach_score ?? 0);
  const originality = Number(payload.originality_score ?? 0);
  const repurposing = Number(payload.repurposing_score ?? 0);
  const hook = Number(payload.hook_score ?? 0);
  const seriesLift = payload.recurring_series ? 6 : 0;
  return clamp(reach * 0.45 + originality * 0.2 + repurposing * 0.2 + hook * 0.15 + seriesLift);
}

function chooseAmplificationChannels(sourceChannel: string) {
  const preferred: DistributionChannel[] = sourceChannel === 'newsletter'
    ? ['bluesky', 'reddit', 'short_video']
    : sourceChannel === 'reddit'
      ? ['bluesky', 'newsletter', 'short_video']
      : sourceChannel === 'short_video'
        ? ['bluesky', 'reddit', 'newsletter']
        : ['reddit', 'newsletter', 'short_video'];

  return preferred.filter((channel) => allowedChannels.has(channel));
}

function buildHookVariants(asset: AssetMetricRow) {
  const strongestLine = trim(asset.summary, trim(asset.hook, asset.title ?? asset.page_slug));
  const objection = trim(String(asset.payload?.strongest_objection ?? ''), strongestLine);
  return [
    `Most buyers miss this: ${strongestLine}`,
    `Avoid this if ${objection.toLowerCase()}`,
    `The real decision is ${strongestLine.toLowerCase()}`,
    `What changed my view: ${strongestLine}`,
    `The buyer warning here is simple: ${objection}`,
  ];
}

function rewriteForChannel(asset: AssetMetricRow, channel: DistributionChannel, winnerScore: number) {
  const baseHook = trim(asset.hook, asset.title ?? asset.page_slug);
  const summary = trim(asset.summary, baseHook);
  const body = trim(asset.body, summary);
  const strongestLine = summary || baseHook;
  const objection = trim(String(asset.payload?.strongest_objection ?? ''), 'Most buyers miss the tradeoff until too late.');
  const proof = trim(String(asset.payload?.proof_point ?? asset.payload?.strongest_claim ?? ''), strongestLine);
  const series = trim(String(asset.payload?.recurring_series ?? asset.payload?.campaign_family ?? 'reach_loop'));
  const suffix = `winner-${hash(`${asset.id}:${channel}:${baseHook}`)}`;
  const ctaUrl = asset.cta_url;

  if (channel === 'bluesky') {
    return {
      channel,
      asset_type: `amplified_bluesky_${suffix}`,
      title: `${asset.page_slug} bluesky winner`,
      hook: `Most smart-ring content misses this: ${strongestLine}`,
      summary: `Winner amplification for Bluesky around one sharp market claim.`,
      body: `${baseHook}\n\nProof: ${proof}\n\nWhy this matters: ${objection}\n\n${ctaUrl ?? ''}`.trim(),
      cta_url: ctaUrl,
      payload: {
        ...asset.payload,
        amplification_source_asset_id: asset.id,
        amplification_source_channel: asset.channel,
        amplification_variant: 'bluesky_hot_take',
        amplification_series: series,
        recurring_series: true,
        winner_score: winnerScore,
        reach_goal: getReachGoalForChannel(channel),
      },
    };
  }

  if (channel === 'reddit') {
    return {
      channel,
      asset_type: `amplified_reddit_${suffix}`,
      title: `${asset.page_slug} reddit winner`,
      hook: `Short answer: ${baseHook}`,
      summary: `Winner amplification in answer-style format for Reddit.`,
      body: [
        `Quick take on ${asset.page_slug.replace(/-/g, ' ')}.`,
        `Main point: ${strongestLine}`,
        `What buyers usually miss: ${objection}`,
        `Proof point: ${proof}`,
        ctaUrl ? `Full breakdown if useful: ${ctaUrl}` : null,
      ].filter(Boolean).join('\n\n'),
      cta_url: ctaUrl,
      payload: {
        ...asset.payload,
        amplification_source_asset_id: asset.id,
        amplification_source_channel: asset.channel,
        amplification_variant: 'reddit_answer_followup',
        amplification_series: series,
        recurring_series: true,
        subreddit_candidates: asset.payload?.subreddit_candidates ?? ['r/wearables', 'r/QuantifiedSelf'],
        winner_score: winnerScore,
        reach_goal: getReachGoalForChannel(channel),
      },
    };
  }

  if (channel === 'newsletter') {
    return {
      channel,
      asset_type: `amplified_newsletter_${suffix}`,
      title: `${asset.page_slug} newsletter winner`,
      hook: baseHook,
      summary: `Winner amplification for owned audience growth.`,
      body: [
        baseHook,
        `Why this is getting traction: ${proof}`,
        `The actual buyer tension: ${objection}`,
        ctaUrl ? `Read the full page: ${ctaUrl}` : null,
      ].filter(Boolean).join('\n\n'),
      cta_url: ctaUrl,
      payload: {
        ...asset.payload,
        amplification_source_asset_id: asset.id,
        amplification_source_channel: asset.channel,
        amplification_variant: 'newsletter_followup',
        amplification_series: series,
        recurring_series: true,
        winner_score: winnerScore,
        reach_goal: getReachGoalForChannel(channel),
      },
    };
  }

  return {
    channel,
    asset_type: `amplified_video_${suffix}`,
    title: `${asset.page_slug} video winner`,
    hook: baseHook,
    summary: `Winner amplification for short-form reach.`,
    body: [
      `0-3s: ${baseHook}`,
      `4-9s: ${proof}`,
      `10-18s: ${objection}`,
      ctaUrl ? `19-25s: Full breakdown at ${ctaUrl}` : '19-25s: Full breakdown in bio.',
    ].join('\n'),
    cta_url: ctaUrl,
    payload: {
      ...asset.payload,
      amplification_source_asset_id: asset.id,
      amplification_source_channel: asset.channel,
      amplification_variant: 'short_video_followup',
      amplification_series: series,
      recurring_series: true,
      winner_score: winnerScore,
      reach_goal: getReachGoalForChannel(channel),
    },
  };
}

async function loadCandidateAssets() {
  const { data, error } = await supabase
    .from('distribution_assets')
    .select('id,page_id,page_slug,channel,asset_type,title,hook,summary,body,cta_url,payload,status')
    .in('status', ['approved', 'published', 'draft'])
    .order('created_at', { ascending: false })
    .limit(LOOKBACK_LIMIT);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[reach-amplifier] distribution_assets missing - skipping until migration is applied.');
    return [] as AssetMetricRow[];
  }
  if (error) throw error;

  return ((data ?? []) as AssetMetricRow[]).filter((asset) => isFreeApiChannel(asset.channel));
}

async function run() {
  const assets = await loadCandidateAssets();
  const winners = assets
    .map((asset) => ({ asset, winnerScore: buildWinnerScore(asset) }))
    .filter((row) => row.winnerScore >= MIN_WINNER_SCORE)
    .sort((a, b) => b.winnerScore - a.winnerScore)
    .slice(0, WINNER_LIMIT);

  if (winners.length === 0) {
    console.log('[reach-amplifier] no winners above threshold.');
    return;
  }

  const amplifiedRows = winners.flatMap(({ asset, winnerScore }) => {
    const variants = buildHookVariants(asset);
    return chooseAmplificationChannels(asset.channel).flatMap((channel, channelIndex) => {
      const rewritten = rewriteForChannel(asset, channel, winnerScore);
      return variants.slice(0, 2).map((variantHook, variantIndex) => ({
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        channel: rewritten.channel,
        asset_type: `${rewritten.asset_type}_v${channelIndex + 1}_${variantIndex + 1}`,
        status: winnerScore >= 82 ? 'approved' : 'draft',
        title: rewritten.title,
        hook: variantHook,
        summary: rewritten.summary,
        body: rewritten.body.replace(trim(rewritten.hook), variantHook),
        cta_url: rewritten.cta_url,
        payload: {
          ...rewritten.payload,
          amplification_hook_variant: variantIndex + 1,
          reach_score: clamp(Math.max(Number(asset.payload?.reach_score ?? 0), winnerScore)),
          originality_score: clamp((Number(asset.payload?.originality_score ?? 60) * 0.7) + 18),
          repurposing_score: clamp((Number(asset.payload?.repurposing_score ?? 55) * 0.6) + 20),
        },
      }));
    });
  });

  if (amplifiedRows.length === 0) {
    console.log('[reach-amplifier] winners found but no allowed amplification channels configured.');
    return;
  }

  const { error: upsertError } = await supabase.from('distribution_assets').upsert(amplifiedRows, {
    onConflict: 'page_id,channel,asset_type',
  });
  if (upsertError?.message?.includes('distribution_assets')) {
    console.log('[reach-amplifier] distribution_assets missing - skipping persistence.');
    return;
  }
  if (upsertError) throw upsertError;

  const { data: persistedAssets, error: persistedError } = await supabase
    .from('distribution_assets')
    .select('id,page_id,page_slug,channel,asset_type,title,hook,summary,body,cta_url,payload')
    .in('page_slug', Array.from(new Set(amplifiedRows.map((row) => row.page_slug))))
    .in('asset_type', amplifiedRows.map((row) => row.asset_type))
    .limit(amplifiedRows.length * 2);

  if (persistedError?.message?.includes('distribution_assets')) {
    console.log('[reach-amplifier] distribution_assets missing during queue readback - skipping queue write.');
    return;
  }
  if (persistedError) throw persistedError;

  const queueRows = ((persistedAssets ?? []) as DistributionAssetRow[]).map((row) => buildPublicationQueueRecord(row));

  const { error: queueError } = await supabase.from('channel_publication_queue').upsert(queueRows, {
    onConflict: 'distribution_asset_id,channel',
  });
  if (queueError?.message?.includes('channel_publication_queue')) {
    console.log('[reach-amplifier] channel_publication_queue missing - skipping queue write.');
    return;
  }
  if (queueError) throw queueError;

  console.log(`[reach-amplifier] winners=${winners.length} amplified=${amplifiedRows.length} channels=${[...allowedChannels].join(',')}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
