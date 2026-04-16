import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { buildPublishUpdate, validatePageForPublish } from '@/lib/page-state';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');
  const { id } = await params;

  if (action !== 'publish') {
    return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
  }

  const { data: page } = await supabaseAdmin
    .from('pages')
    .select('id,slug,status,template,title,meta_description,h1,intro,body_json,pillar_id,primary_keyword,secondary_keywords,internal_links,schema_org,metadata,published_at,updated_at')
    .eq('id', id)
    .single();

  if (!page || !['draft', 'approved'].includes(page.status)) {
    return NextResponse.redirect(new URL('/admin?error=not_draft', req.url), { status: 302 });
  }

  const { schemaOrg, errors } = validatePageForPublish(page as any);
  if (errors.length) {
    const redirectUrl = new URL('/admin', req.url);
    redirectUrl.searchParams.set('error', 'publish_validation_failed');
    redirectUrl.searchParams.set('detail', errors.join('; '));
    return NextResponse.redirect(redirectUrl, { status: 302 });
  }

  await supabaseAdmin
    .from('pages')
    .update({ ...buildPublishUpdate(page as any), schema_org: schemaOrg })
    .eq('id', id);

  await logAdminAction({ action: 'publish_draft', target_type: 'page', target_id: id, metadata: { template: page.template } });
  return NextResponse.redirect(new URL('/admin?ok=draft_published', req.url), { status: 302 });
}
