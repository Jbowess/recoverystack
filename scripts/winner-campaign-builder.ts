import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { isFreeApiChannel } from '@/lib/free-distribution-policy';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function trim(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function scoreWinner(asset: any) {
  const payload = asset.payload ?? {};
  return Number(payload.reach_score ?? 0) * 0.5 + Number(payload.originality_score ?? 0) * 0.25 + Number(payload.repurposing_score ?? 0) * 0.25;
}

async function run() {
  const { data, error } = await supabase
    .from('distribution_assets')
    .select('id,page_id,page_slug,page_template,channel,asset_type,title,hook,summary,body,cta_url,payload,status')
    .in('status', ['approved', 'published'])
    .order('created_at', { ascending: false })
    .limit(160);

  if (error?.message?.includes('distribution_assets')) {
    console.log('[winner-campaign-builder] distribution_assets missing - skipping.');
    return;
  }
  if (error) throw error;

  const winners = (data ?? [])
    .filter((asset: any) => isFreeApiChannel(asset.channel))
    .map((asset: any) => ({ asset, score: scoreWinner(asset) }))
    .filter((row: any) => row.score >= 70)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 18);

  let written = 0;
  for (const { asset, score } of winners) {
    const baseHook = trim(asset.hook, asset.title ?? asset.page_slug);
    const summary = trim(asset.summary, baseHook);
    const objection = trim(String(asset.payload?.strongest_objection ?? ''), 'The buyer mistake is anchoring on the wrong thing.');
    const rows = [
      ...Array.from({ length: 5 }, (_, index) => ({
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        page_template: asset.page_template,
        channel: 'bluesky',
        asset_type: `winner_hook_${index + 1}`,
        status: 'approved',
        title: `${asset.page_slug} winner hook ${index + 1}`,
        hook: [
          `Most buyers miss this: ${baseHook}`,
          `The real issue is ${summary.toLowerCase()}`,
          `Avoid this if ${objection.toLowerCase()}`,
          `The smart-ring take I would repeat: ${baseHook}`,
          `This is the buyer warning people skip: ${objection}`,
        ][index],
        summary: 'Winner hook variant.',
        body: summary,
        cta_url: asset.cta_url,
        payload: { winner_source_asset_id: asset.id, campaign_role: 'hook_variant', winner_score: score },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        page_template: asset.page_template,
        channel: 'newsletter',
        asset_type: `winner_angle_${index + 1}`,
        status: 'approved',
        title: `${asset.page_slug} winner angle ${index + 1}`,
        hook: [baseHook, summary, objection][index],
        summary: 'Winner angle follow-up.',
        body: [`Angle ${index + 1}`, [baseHook, summary, objection][index], `Source asset: ${asset.title ?? asset.page_slug}`].join('\n\n'),
        cta_url: asset.cta_url,
        payload: { winner_source_asset_id: asset.id, campaign_role: 'angle_variant', winner_score: score },
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        page_template: asset.page_template,
        channel: 'reddit',
        asset_type: `winner_followup_${index + 1}`,
        status: 'draft',
        title: `${asset.page_slug} winner follow-up ${index + 1}`,
        hook: `Follow-up ${index + 1}: ${baseHook}`,
        summary: 'Winner follow-up community post.',
        body: [`Follow-up point ${index + 1}`, summary, objection].join('\n\n'),
        cta_url: asset.cta_url,
        payload: { winner_source_asset_id: asset.id, campaign_role: 'followup_post', winner_score: score, subreddit_candidates: ['r/wearables', 'r/QuantifiedSelf'] },
      })),
      {
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        page_template: asset.page_template,
        channel: 'short_video',
        asset_type: 'winner_visual_variant',
        status: 'approved',
        title: `${asset.page_slug} winner visual`,
        hook: baseHook,
        summary: 'Winner visual brief.',
        body: [`Visual: scorecard`, `Headline: ${baseHook}`, `Support: ${summary}`, `Warning: ${objection}`].join('\n'),
        cta_url: asset.cta_url,
        payload: { winner_source_asset_id: asset.id, campaign_role: 'visual_variant', winner_score: score },
      },
      {
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        page_template: asset.page_template,
        channel: 'short_video',
        asset_type: 'winner_video_variant',
        status: 'approved',
        title: `${asset.page_slug} winner video`,
        hook: baseHook,
        summary: 'Winner video script.',
        body: [`0-3s: ${baseHook}`, `4-10s: ${summary}`, `11-18s: ${objection}`, '19-25s: direct to the full page'].join('\n'),
        cta_url: asset.cta_url,
        payload: { winner_source_asset_id: asset.id, campaign_role: 'video_variant', winner_score: score },
      },
      {
        page_id: asset.page_id,
        page_slug: asset.page_slug,
        page_template: asset.page_template,
        channel: 'reddit',
        asset_type: 'winner_community_variant',
        status: 'draft',
        title: `${asset.page_slug} winner community`,
        hook: `Community angle: ${baseHook}`,
        summary: 'Winner community reply prompt.',
        body: [`Community prompt`, summary, `Question: would you challenge ${objection.toLowerCase()}?`].join('\n\n'),
        cta_url: asset.cta_url,
        payload: { winner_source_asset_id: asset.id, campaign_role: 'community_variant', winner_score: score, subreddit_candidates: ['r/wearables', 'r/QuantifiedSelf'] },
      },
    ];

    written += rows.length;
    if (DRY_RUN) continue;

    const { error: upsertError } = await supabase.from('distribution_assets').upsert(rows, {
      onConflict: 'page_id,channel,asset_type',
    });
    if (upsertError?.message?.includes('distribution_assets')) {
      console.log('[winner-campaign-builder] distribution_assets missing - skipping persistence.');
      return;
    }
    if (upsertError) throw upsertError;
  }

  console.log(`[winner-campaign-builder] campaigns=${winners.length} assets=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
