import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const VALID_ACTIONS = new Set(['approve', 'reject', 'defer']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');
  const { id } = await params;

  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
  }

  const { data: queueItem } = await supabaseAdmin
    .from('content_refresh_queue')
    .select('id,page_id')
    .eq('id', id)
    .single();

  if (!queueItem) {
    return NextResponse.redirect(new URL('/admin?error=refresh_item_not_found', req.url), { status: 302 });
  }

  const statusByAction: Record<string, string> = {
    approve: 'approved',
    reject: 'rejected',
    defer: 'deferred',
  };

  await supabaseAdmin
    .from('content_refresh_queue')
    .update({ status: statusByAction[action], processed_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.redirect(new URL(`/admin?ok=refresh_${action}d`, req.url), { status: 302 });
}
