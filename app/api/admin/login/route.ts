import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

  // Store a hashed token in the cookie instead of the plaintext password
  const sessionToken = randomBytes(32).toString('hex');
  const hashedToken = hashToken(sessionToken);

  const res = NextResponse.redirect(new URL('/admin', req.url), { status: 302 });
  res.cookies.set('rs_admin', `${sessionToken}:${hashedToken}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return res;
}
