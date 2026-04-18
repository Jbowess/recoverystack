/**
 * /api/news-rss
 *
 * Dedicated Google News–compatible RSS 2.0 feed for the news template.
 * Includes the <news:news> namespace required for Google News Publisher Center
 * submission and the <media:content> extension for thumbnail images.
 *
 * Submit this URL in Google News Publisher Center:
 *   https://publishercenter.google.com
 *   Feed URL: https://recoverystack.io/api/news-rss
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase-env';

const SITE = process.env.SITE_URL ?? 'https://recoverystack.io';
const PUBLICATION_NAME = 'RecoveryStack';
const PUBLICATION_LANGUAGE = 'en';

const BEAT_LABELS: Record<string, string> = {
  wearables: 'Wearables',
  sleep_tech: 'Sleep Tech',
  sleep_science: 'Sleep Science',
  recovery_protocols: 'Recovery',
  nutrition: 'Nutrition',
  regulatory: 'Regulatory',
  performance: 'Performance',
  general_recovery: 'Recovery',
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(dateStr: string): string {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const beat = searchParams.get('beat') ?? null;

  const supabase = createClient(
    getSupabaseUrl() ?? '',
    getSupabasePublicKey() ?? '',
  );

  let query = supabase
    .from('pages')
    .select('slug, title, meta_description, published_at, updated_at, beat, news_format, metadata')
    .eq('status', 'published')
    .eq('template', 'news')
    .order('published_at', { ascending: false })
    .limit(50);

  if (beat) {
    query = query.eq('beat', beat);
  }

  const { data } = await query;
  const pages = data ?? [];

  const feedUrl = beat ? `${SITE}/api/news-rss?beat=${beat}` : `${SITE}/api/news-rss`;
  const feedTitle = beat
    ? `RecoveryStack ${BEAT_LABELS[beat] ?? beat} News`
    : 'RecoveryStack — Recovery & Fitness Tech News';

  const items = pages
    .map((p: any) => {
      const url = `${SITE}/news/${p.slug}`;
      const pubDate = toRfc822(p.published_at ?? p.updated_at);
      const category = p.beat ? (BEAT_LABELS[p.beat] ?? p.beat) : 'Recovery';
      const heroImage = typeof p.metadata?.hero_image === 'string' && p.metadata.hero_image
        ? p.metadata.hero_image
        : null;

      // Google News requires published date within the last 2 days for inclusion,
      // but older articles still populate the feed for subscribers.
      const newsNamespace = `
      <news:news>
        <news:publication>
          <news:name>${escapeXml(PUBLICATION_NAME)}</news:name>
          <news:language>${PUBLICATION_LANGUAGE}</news:language>
        </news:publication>
        <news:publication_date>${escapeXml(pubDate)}</news:publication_date>
        <news:title>${escapeXml(p.title ?? p.slug)}</news:title>
        <news:keywords>${escapeXml(category)}</news:keywords>
      </news:news>`;

      const mediaContent = heroImage
        ? `\n      <media:content url="${escapeXml(heroImage)}" medium="image" />`
        : '';

      return `    <item>
      <title>${escapeXml(p.title ?? p.slug)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(p.meta_description ?? '')}</description>
      <category>${escapeXml(category)}</category>${newsNamespace}${mediaContent}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${SITE}/news</link>
    <description>Breaking news, research briefs, and expert commentary on fitness technology and recovery science.</description>
    <language>${PUBLICATION_LANGUAGE}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <image>
      <url>${SITE}/logo.png</url>
      <title>${escapeXml(PUBLICATION_NAME)}</title>
      <link>${SITE}/news</link>
    </image>
${items}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
    },
  });
}
