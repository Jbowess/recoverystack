import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

// Cache for 5 minutes on CDN; revalidate in background
const CACHE_MAX_AGE = 300;
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const TEMPLATE_CATEGORY_MAP: Record<string, string> = {
  guides: 'Guide',
  alternatives: 'Alternative',
  protocols: 'Protocol',
  metrics: 'Metric',
  costs: 'Cost',
  compatibility: 'Compatibility',
  trends: 'Trend',
  pillars: 'Overview',
};

type FeedItem = {
  title: string;
  slug: string;
  url: string;
  template: string;
  category: string;
  published_at: string;
  meta_description: string | null;
};

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const rawPage = parseInt(searchParams.get('page') ?? '1', 10);
  const rawLimit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10);
  const template = searchParams.get('template') ?? null;

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : PAGE_SIZE;
  const offset = (page - 1) * limit;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from('pages')
    .select('title, slug, template, published_at, meta_description', { count: 'exact' })
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (template) {
    query = query.eq('template', template);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch feed' }, { status: 500 });
  }

  const items: FeedItem[] = (data ?? []).map((row) => ({
    title: row.title ?? '',
    slug: row.slug,
    url: `${SITE_URL}/${row.template}/${row.slug}`,
    template: row.template ?? 'guides',
    category: TEMPLATE_CATEGORY_MAP[row.template] ?? 'Article',
    published_at: row.published_at,
    meta_description: row.meta_description ?? null,
  }));

  const totalCount = count ?? 0;
  const totalPages = Math.ceil(totalCount / limit);

  const response = NextResponse.json({
    items,
    pagination: {
      page,
      limit,
      total: totalCount,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  });

  response.headers.set('Cache-Control', `public, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=60`);
  return response;
}
