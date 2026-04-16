import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createAdminSessionCookieValue, getAdminSessionCookieOptions } from '@/lib/admin-session';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = String(formData.get('password') ?? '');

  if (!process.env.ADMIN_PASSWORD || !safeCompare(password, process.env.ADMIN_PASSWORD)) {
    return NextResponse.redirect(new URL('/admin/login?error=1', req.url), { status: 302 });
  }

  const res = NextResponse.redirect(new URL('/admin', req.url), { status: 302 });
  const { name, options } = getAdminSessionCookieOptions();
  res.cookies.set(name, createAdminSessionCookieValue(), options);
  return res;
}
