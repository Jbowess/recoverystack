import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

function authorized(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  return Boolean(secret && secret === process.env.REVALIDATE_SECRET);
}

function resolvePath(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  const template = req.nextUrl.searchParams.get('template');
  const path = req.nextUrl.searchParams.get('path');
  if (path) return path;
  if (slug && template) return `/${template}/${slug}`;
  return null;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const path = resolvePath(req);
  if (!path) return NextResponse.json({ ok: false, error: 'missing path' }, { status: 400 });
  revalidatePath(path);
  return NextResponse.json({ ok: true, path });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const path = body.path ?? (body.slug && body.template ? `/${body.template}/${body.slug}` : null);
  if (!path) return NextResponse.json({ ok: false, error: 'missing path' }, { status: 400 });
  revalidatePath(path);
  return NextResponse.json({ ok: true, path });
}
