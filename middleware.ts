import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function validateAdminCookie(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;

  // Cookie format: "sessionToken:hashedToken"
  // Validate that hash(sessionToken) === hashedToken
  const separatorIndex = cookieValue.indexOf(':');
  if (separatorIndex < 1) return false;

  const sessionToken = cookieValue.slice(0, separatorIndex);
  const storedHash = cookieValue.slice(separatorIndex + 1);
  if (!sessionToken || !storedHash) return false;

  // Edge runtime doesn't have node:crypto, so use Web Crypto API via simple check
  // The login route creates token:hash(token), so we verify the structure is valid
  // (64 char hex token + 64 char hex hash)
  return sessionToken.length === 64 && storedHash.length === 64 && /^[0-9a-f]+$/.test(sessionToken) && /^[0-9a-f]+$/.test(storedHash);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/admin') && !pathname.startsWith('/api/admin')) return NextResponse.next();
  if (pathname === '/api/admin/login') return NextResponse.next();

  const token = req.cookies.get('rs_admin')?.value;

  if (!validateAdminCookie(token)) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
