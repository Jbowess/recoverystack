import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { toShareOfVoiceRow } from '@/lib/brand-operating-system';

config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

function topicFor(page: any) {
  const keyword = `${page.primary_keyword ?? ''} ${page.title ?? ''}`.toLowerCase();
  if (keyword.includes('oura')) return 'oura';
  if (keyword.includes('ringconn')) return 'ringconn';
  if (keyword.includes('ultrahuman')) return 'ultrahuman';
  if (keyword.includes('smart ring')) return 'smart_ring_category';
  return page.template ?? 'general';
}

async function run() {
  const [pagesResult, socialResult, conversionsResult, creatorsResult] = await Promise.all([
    supabase.from('pages').select('slug,title,template,primary_keyword,quality_score,originality_score').eq('status', 'published').limit(300),
    supabase.from('social_channel_metrics').select('channel,impressions,clicks,engagements,conversions').limit(2500),
    supabase.from('page_conversion_aggregates').select('page_slug,conversion_count,cta_click_count').limit(1000),
    supabase.from('creator_relationships').select('relevance_score,relationship_stage').limit(300),
  ]);

  if (pagesResult.error) throw pagesResult.error;
  const pages = pagesResult.data ?? [];
  const conversionsBySlug = new Map((conversionsResult.data ?? []).map((row: any) => [row.page_slug, row]));
  const creatorLift = (creatorsResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.relevance_score ?? 0), 0) / Math.max((creatorsResult.data ?? []).length, 1);

  const rows = pages.flatMap((page: any) => {
    const conversion = conversionsBySlug.get(page.slug);
    const channels = ['seo', 'newsletter', 'social'];
    return channels.map((channel) => {
      const channelMetrics = (socialResult.data ?? []).filter((row: any) => {
        if (channel === 'social') return ['x', 'linkedin', 'instagram', 'facebook', 'reddit', 'short_video'].includes(row.channel);
        if (channel === 'newsletter') return row.channel === 'newsletter';
        return false;
      });

      const visibility =
        channel === 'seo'
          ? Number(page.quality_score ?? 55) + Number(page.originality_score ?? 0) / 5
          : channelMetrics.reduce((sum: number, row: any) => sum + Number(row.impressions ?? 0), 0) / 50;
      const engagement = channelMetrics.reduce((sum: number, row: any) => sum + Number(row.engagements ?? 0), 0) / 10;
      const conversionScore =
        channel === 'seo'
          ? Number(conversion?.conversion_count ?? 0) * 8 + Number(conversion?.cta_click_count ?? 0)
          : channelMetrics.reduce((sum: number, row: any) => sum + Number(row.conversions ?? 0), 0) * 10;
      const authority = Number(page.originality_score ?? 60) * 0.4 + Number(page.quality_score ?? 55) * 0.4 + creatorLift * 0.2;
      const competitorPressure = /oura|ringconn|ultrahuman|samsung/i.test(`${page.primary_keyword ?? ''} ${page.title}`) ? 72 : 48;

      return toShareOfVoiceRow({
        marketSlug: 'smart_ring',
        topicSlug: topicFor(page),
        channel,
        visibility,
        engagement,
        conversion: conversionScore,
        authority,
        competitorPressure,
        metadata: { page_slug: page.slug },
      });
    });
  });

  if (DRY_RUN) {
    console.log(`[share-of-voice-rollup] rows=${rows.length} dryRun=true`);
    return;
  }

  const { error } = await supabase.from('share_of_voice_snapshots').upsert(rows, {
    onConflict: 'snapshot_date,market_slug,topic_slug,channel',
  } as never);
  if (error?.message?.includes('share_of_voice_snapshots')) {
    console.log('[share-of-voice-rollup] share_of_voice_snapshots missing - skipping persistence.');
    return;
  }
  if (error) throw error;
  console.log(`[share-of-voice-rollup] rows=${rows.length} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
