/**
 * Google News Sitemap
 *
 * Serves a Google News-compatible sitemap for the trends template.
 * Google News crawlers check this within minutes of a new URL appearing.
 *
 * Spec: https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap
 *
 * Key rules:
 *   - Only include articles published within the last 2 days
 *   - Max 1000 articles per sitemap
 *   - <news:publication_date> must be within 48 hours
 *   - <news:title> must match the article's actual title
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase-env';

const SITE = process.env.SITE_URL ?? 'https://recoverystack.io';
const PUBLICATION_NAME = 'RecoveryStack';
const PUBLICATION_LANGUAGE = 'en';

// News sitemap: articles from last 48 hours
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const supabase = createClient(
    getSupabaseUrl() ?? '',
    getSupabasePublicKey() ?? '',
  );

  const cutoff = new Date(Date.now() - TWO_DAYS_MS).toISOString();

  // Google News sitemap: only include news template pages published in the last 48 hours.
  // Evergreen guides and other templates are excluded — Google News wants genuine news articles.
  const { data } = await supabase
    .from('pages')
    .select('slug, template, title, published_at, updated_at, primary_keyword')
    .eq('status', 'published')
    .eq('template', 'news')
    .gte('published_at', cutoff)
    .order('published_at', { ascending: false })
    .limit(1000);

  const items = (data ?? []).map((page) => {
    const url = `${SITE}/${page.template}/${page.slug}`;
    const pubDate = new Date(page.published_at ?? page.updated_at).toISOString();
    const title = escapeXml(page.title ?? page.slug);
    const keywords = page.primary_keyword ? escapeXml(page.primary_keyword) : '';

    return `  <url>
    <loc>${url}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(PUBLICATION_NAME)}</news:name>
        <news:language>${PUBLICATION_LANGUAGE}</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${title}</news:title>
      ${keywords ? `<news:keywords>${keywords}</news:keywords>` : ''}
    </news:news>
  </url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${items.join('\n')}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Short cache — news content needs to be freshly indexed
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  });
}
