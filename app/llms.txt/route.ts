import { NextResponse } from 'next/server';
import { buildLlmsTxt } from '@/lib/llm-discovery';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const siteUrl = process.env.SITE_URL ?? 'https://recoverystack.io';
  const siteName = 'RecoveryStack';

  let pages: Array<{ title: string; url: string; description?: string | null }> = [];

  try {
    const { data, error } = await supabaseAdmin
      .from('pages')
      .select('title,template,slug,meta_description')
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(20);

    if (!error) {
      pages = (data ?? []).map((row: any) => ({
        title: row.title,
        url: `${siteUrl}/${row.template}/${row.slug}`,
        description: row.meta_description ?? null,
      }));
    }
  } catch {
    // Fall back to a minimal llms.txt when the database is unavailable.
  }

  const body = buildLlmsTxt({
    siteUrl,
    siteName,
    summary: 'Evidence-led recovery technology coverage, product comparisons, and buyer-intent pages designed for both human search and LLM citation.',
    pages,
    sitemapUrl: `${siteUrl}/sitemap.xml`,
    feedUrl: `${siteUrl}/api/merchant/product-feed`,
    assistantCatalogUrl: `${siteUrl}/api/assistant/catalog`,
    researchUrl: `${siteUrl}/research`,
    evidenceUrl: `${siteUrl}/evidence`,
    toolsUrl: `${siteUrl}/tools`,
  });

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
    },
  });
}
