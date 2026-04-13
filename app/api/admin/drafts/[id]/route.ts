import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runPublishGuards } from '@/lib/publish-guards';
import { logAdminAction } from '@/lib/admin-audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');
  const { id } = await params;

  if (action !== 'publish') {
    return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
  }

  const { data: page } = await supabaseAdmin
    .from('pages')
    .select('id,status,template,title,intro,body_json,schema_org,internal_links')
    .eq('id', id)
    .single();

  if (!page || page.status !== 'draft') {
    return NextResponse.redirect(new URL('/admin?error=not_draft', req.url), { status: 302 });
  }

  const guardErrors = runPublishGuards(page);
  if (guardErrors.length) {
    const redirectUrl = new URL('/admin', req.url);
    redirectUrl.searchParams.set('error', 'publish_validation_failed');
    redirectUrl.searchParams.set('detail', guardErrors.join('; '));
    return NextResponse.redirect(redirectUrl, { status: 302 });
  }

  await supabaseAdmin
    .from('pages')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id);

  await logAdminAction({ action: 'publish_draft', target_type: 'page', target_id: id, metadata: { template: page.template } });
  return NextResponse.redirect(new URL('/admin?ok=draft_published', req.url), { status: 302 });
}
