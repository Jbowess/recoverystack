import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildPagePath, buildPublishUpdate, validatePageForPublish } from '@/lib/page-state';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pageIds: string[] = body?.page_ids;
  const status: string = body?.status;

  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return NextResponse.json({ error: 'page_ids array is required' }, { status: 400 });
  }

  if (!['draft', 'approved', 'published'].includes(status)) {
    return NextResponse.json({ error: 'status must be "draft", "approved", or "published"' }, { status: 400 });
  }

  const { data: pages, error: pagesError } = await supabaseAdmin.from('pages').select('*').in('id', pageIds);
  if (pagesError) return NextResponse.json({ error: pagesError.message }, { status: 500 });
  if (!pages || pages.length === 0) return NextResponse.json({ error: 'No pages found' }, { status: 404 });

  if (status === 'published') {
    const failures: Array<{ id: string; slug: string; errors: string[] }> = [];

    for (const page of pages) {
      const { errors } = validatePageForPublish(page as any);
      if (errors.length) {
        failures.push({ id: page.id, slug: page.slug, errors });
      }
    }

    if (failures.length) {
      return NextResponse.json({ error: 'Publish blocked by validation guards', failures }, { status: 400 });
    }

    for (const page of pages) {
      const { schemaOrg } = validatePageForPublish(page as any);
      const { error } = await supabaseAdmin
        .from('pages')
        .update({ ...buildPublishUpdate(page as any), schema_org: schemaOrg })
        .eq('id', page.id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      revalidatePath(buildPagePath(page as any));
    }

    return NextResponse.json({ updated: pages.length, pages: pages.map((page) => ({ id: page.id, slug: page.slug, template: page.template, status })) });
  }

  const update: Record<string, unknown> = { status };
  const { data, error } = await supabaseAdmin.from('pages').update(update).in('id', pageIds).select('id,slug,template,status');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated: data?.length ?? 0, pages: data });
}
