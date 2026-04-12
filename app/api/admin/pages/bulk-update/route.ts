import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pageIds: string[] = body?.page_ids;
  const status: string = body?.status;

  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return NextResponse.json({ error: 'page_ids array is required' }, { status: 400 });
  }

  if (!['draft', 'published'].includes(status)) {
    return NextResponse.json({ error: 'status must be "draft" or "published"' }, { status: 400 });
  }

  const update: Record<string, unknown> = { status };
  if (status === 'published') {
    update.published_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('pages')
    .update(update)
    .in('id', pageIds)
    .select('id,slug,template,status');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Revalidate published pages
  if (status === 'published' && data) {
    for (const page of data) {
      revalidatePath(`/${page.template}/${page.slug}`);
    }
  }

  return NextResponse.json({ updated: data?.length ?? 0, pages: data });
}
