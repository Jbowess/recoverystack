import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildPagePath, buildPublishUpdate, validatePageForPublish } from '@/lib/page-state';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('pages')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  return NextResponse.json({ page: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const { data: existing, error: existingError } = await supabaseAdmin.from('pages').select('*').eq('id', id).single();
  if (existingError || !existing) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  // Allow updating specific fields only
  const allowedFields = [
    'title', 'meta_description', 'h1', 'intro', 'body_json',
    'primary_keyword', 'secondary_keywords', 'status', 'schema_org',
    'internal_links', 'pillar_id',
  ] as const;

  const update: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const nextPage = { ...existing, ...update };
  const nextStatus = (update.status ?? existing.status) as string;
  const nextIsPublished = nextStatus === 'published';

  if (nextIsPublished) {
    const { schemaOrg, errors } = validatePageForPublish(nextPage as any);
    if (errors.length) {
      return NextResponse.json({ error: 'Publish blocked by validation guards', details: errors }, { status: 400 });
    }

    Object.assign(update, buildPublishUpdate(nextPage as any), { schema_org: schemaOrg });
  } else if (existing.status === 'published') {
    update.needs_revalidation = true;
  }

  const { data, error } = await supabaseAdmin
    .from('pages')
    .update(update)
    .eq('id', id)
    .select('id,slug,template,title,status,updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  // Revalidate the page path if it was published
  if (nextIsPublished) {
    revalidatePath(buildPagePath(data as any));
  }

  return NextResponse.json({ page: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: page } = await supabaseAdmin
    .from('pages')
    .select('id,slug,template')
    .eq('id', id)
    .single();

  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const { error } = await supabaseAdmin.from('pages').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true, slug: page.slug });
}
