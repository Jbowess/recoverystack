import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('pages')
    .select('id,slug,template,title,status,primary_keyword,published_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pages: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.slug || !body.template || !body.title) {
    return NextResponse.json({ error: 'slug, template, and title are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('pages')
    .insert({
      slug: body.slug,
      template: body.template,
      title: body.title,
      meta_description: body.meta_description ?? '',
      h1: body.h1 ?? body.title,
      intro: body.intro ?? null,
      primary_keyword: body.primary_keyword ?? null,
      status: 'draft',
    })
    .select('id,slug,template,title,status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ page: data }, { status: 201 });
}
