import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) return NextResponse.next();
  if (pathname === '/api/admin/login') return NextResponse.next();

  const token = req.cookies.get('rs_admin')?.value;
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || token !== expected) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
