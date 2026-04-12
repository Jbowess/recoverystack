import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function authorized(req: NextRequest) {
  // Support both Authorization header (preferred) and query param (deprecated)
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const queryToken = req.nextUrl.searchParams.get('secret');
  const token = headerToken ?? queryToken;
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !token) return false;
  return safeCompare(token, expected);
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
  if (!authorized(req)) {
    // Also check body.secret for backwards compatibility
    const body = await req.json().catch(() => ({}));
    const expected = process.env.REVALIDATE_SECRET;
    if (!expected || !body.secret || !safeCompare(body.secret, expected)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    const path = body.path ?? (body.slug && body.template ? `/${body.template}/${body.slug}` : null);
    if (!path) return NextResponse.json({ ok: false, error: 'missing path' }, { status: 400 });
    revalidatePath(path);
    return NextResponse.json({ ok: true, path });
  }

  const body = await req.json().catch(() => ({}));
  const path = body.path ?? (body.slug && body.template ? `/${body.template}/${body.slug}` : null);
  if (!path) return NextResponse.json({ ok: false, error: 'missing path' }, { status: 400 });
  revalidatePath(path);
  return NextResponse.json({ ok: true, path });
}
