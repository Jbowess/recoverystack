import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase-env';

const SITE = process.env.SITE_URL ?? 'https://recoverystack.io';
const FEED_TITLE = 'RecoveryStack.io — Recovery Intelligence';
const FEED_DESCRIPTION = 'Evidence-based protocols, device insights, and recovery performance analysis.';

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

  const { data } = await supabase
    .from('pages')
    .select('slug,template,title,meta_description,published_at,updated_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20);

  const items = (data ?? [])
    .map((p) => {
      const url = `${SITE}/${p.template}/${p.slug}`;
      const pubDate = new Date(p.published_at ?? p.updated_at).toUTCString();
      return `    <item>
      <title>${escapeXml(p.title ?? p.slug)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(p.meta_description ?? '')}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${SITE}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en-AU</language>
    <atom:link href="${SITE}/api/rss" rel="self" type="application/rss+xml" />
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
