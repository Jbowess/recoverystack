import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildTrackedUrl } from '@/lib/distribution-engine';
import { pickReachThesis } from '@/lib/reach-theses';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

function trim(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function eventAssetType(prefix: string, eventId: string) {
  return `${prefix}_${String(eventId).slice(0, 8)}`;
}

async function run() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [eventsResult, pagesResult] = await Promise.all([
    supabase
      .from('news_source_events')
      .select('id,title,summary,beat,metadata,published_at')
      .gte('published_at', sevenDaysAgo)
      .order('published_at', { ascending: false })
      .limit(40),
    supabase
      .from('pages')
      .select('id,slug,template,title,primary_keyword,meta_description,body_json,metadata,updated_at')
      .in('status', ['published', 'approved'])
      .in('template', ['news', 'trends', 'reviews', 'alternatives'])
      .order('updated_at', { ascending: false })
      .limit(120),
  ]);

  if (eventsResult.error?.message?.includes('news_source_events')) {
    console.log('[rapid-response-engine] news_source_events missing - skipping.');
    return;
  }
  if (eventsResult.error) throw eventsResult.error;
  if (pagesResult.error) throw pagesResult.error;

  const events = (eventsResult.data ?? []) as Array<{ id: string; title: string; summary: string | null; beat: string | null }>;
  const pages = (pagesResult.data ?? []) as Array<any>;
  let written = 0;

  for (const event of events.slice(0, 12)) {
    const relatedPage = pages.find((page) => {
      const haystack = `${page.title} ${page.primary_keyword ?? ''} ${page.meta_description ?? ''}`.toLowerCase();
      return haystack.includes(trim(event.beat).toLowerCase()) || haystack.includes(trim(event.title).toLowerCase().split(' ')[0] ?? '');
    }) ?? pages[0];

    if (!relatedPage) continue;

    const thesis = pickReachThesis({
      title: relatedPage.title,
      primaryKeyword: relatedPage.primary_keyword,
      template: relatedPage.template,
      body: `${event.title} ${event.summary ?? ''}`,
    });
    const trackedUrl = buildTrackedUrl(`${SITE_URL}/${relatedPage.template}/${relatedPage.slug}`, 'bluesky', 'rapid_response', relatedPage.slug);
    const rows = [
      {
        page_id: relatedPage.id,
        page_slug: relatedPage.slug,
        page_template: relatedPage.template,
        channel: 'bluesky',
        asset_type: eventAssetType('rapid_response_bluesky', event.id),
        status: 'approved',
        title: `${event.title} rapid response`,
        hook: `${event.title}: ${thesis.thesis}`,
        summary: 'Rapid-response hot take for free social distribution.',
        body: [`${event.title}`, thesis.thesis, trim(event.summary, 'This changes the buying context more than most people think.'), trackedUrl].join('\n\n'),
        cta_url: trackedUrl,
        payload: { response_type: 'rapid_response', thesis_slug: thesis.slug, event_id: event.id, beat: event.beat, recurring_series: 'rapid_response' },
      },
      {
        page_id: relatedPage.id,
        page_slug: relatedPage.slug,
        page_template: relatedPage.template,
        channel: 'reddit',
        asset_type: eventAssetType('rapid_response_reddit', event.id),
        status: 'draft',
        title: `${event.title} reddit angle`,
        hook: `Does this change the smart-ring decision? ${event.title}`,
        summary: 'Rapid-response Reddit/community angle.',
        body: [`Question for the community: ${event.title}`, `My take: ${thesis.thesis}`, trim(event.summary, relatedPage.meta_description ?? relatedPage.title), `Full context: ${trackedUrl}`].join('\n\n'),
        cta_url: trackedUrl,
        payload: { response_type: 'rapid_response', thesis_slug: thesis.slug, event_id: event.id, beat: event.beat, subreddit_candidates: ['r/wearables', 'r/QuantifiedSelf'] },
      },
      {
        page_id: relatedPage.id,
        page_slug: relatedPage.slug,
        page_template: relatedPage.template,
        channel: 'short_video',
        asset_type: eventAssetType('rapid_response_video', event.id),
        status: 'approved',
        title: `${event.title} video response`,
        hook: `${event.title} changes one thing for buyers.`,
        summary: 'Rapid-response video script.',
        body: [`0-3s: ${event.title}`, `4-10s: ${thesis.thesis}`, `11-18s: ${trim(event.summary, 'Here is what actually changed.')}`, `19-25s: Full breakdown at ${trackedUrl}`].join('\n'),
        cta_url: trackedUrl,
        payload: { response_type: 'rapid_response', thesis_slug: thesis.slug, event_id: event.id, beat: event.beat, recurring_series: 'rapid_response' },
      },
      {
        page_id: relatedPage.id,
        page_slug: relatedPage.slug,
        page_template: relatedPage.template,
        channel: 'newsletter',
        asset_type: eventAssetType('rapid_response_newsletter', event.id),
        status: 'approved',
        title: `${event.title} breaking brief`,
        hook: `${event.title}: what it actually means`,
        summary: 'Breaking brief for newsletter and owned audience.',
        body: [`Event: ${event.title}`, `Why it matters: ${thesis.thesis}`, trim(event.summary, relatedPage.meta_description ?? relatedPage.title), `Read the full page: ${trackedUrl}`].join('\n\n'),
        cta_url: trackedUrl,
        payload: { response_type: 'rapid_response', thesis_slug: thesis.slug, event_id: event.id, beat: event.beat, recurring_series: 'rapid_response' },
      },
    ];

    written += rows.length;
    if (DRY_RUN) continue;

    const { error } = await supabase.from('distribution_assets').upsert(rows, { onConflict: 'page_id,channel,asset_type' });
    if (error?.message?.includes('distribution_assets')) {
      console.log('[rapid-response-engine] distribution_assets missing - skipping persistence.');
      return;
    }
    if (error) throw error;
  }

  console.log(`[rapid-response-engine] assets=${written} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
