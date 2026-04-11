import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { slugify } from '@/lib/slugify';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');
  const { id } = await params;

  const { data: trend } = await supabaseAdmin.from('trends').select('*').eq('id', id).single();
  if (!trend) return NextResponse.redirect(new URL('/admin?error=trend_not_found', req.url), { status: 302 });

  if (action === 'reject') {
    await supabaseAdmin.from('trends').update({ status: 'rejected' }).eq('id', id);
    return NextResponse.redirect(new URL('/admin', req.url), { status: 302 });
  }

  if (action === 'approve') {
    await supabaseAdmin.from('trends').update({ status: 'queued' }).eq('id', id);

    const slug = slugify(`what-is-${trend.term}`);
    const title = `What is ${trend.term}? Evidence, use-cases, and limits`;

    await supabaseAdmin.from('pages').upsert(
      {
        slug,
        template: 'trends',
        title,
        meta_description: `Evidence-first breakdown of ${trend.term} for athletes and recovery planning.`,
        h1: `What is ${trend.term}?`,
        intro: `A practical review of ${trend.term} with signal quality, implementation risks, and athlete relevance.`,
        primary_keyword: trend.term,
        status: 'draft',
      },
      { onConflict: 'slug' },
    );

    return NextResponse.redirect(new URL('/admin?ok=trend_approved', req.url), { status: 302 });
  }

  return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
}
