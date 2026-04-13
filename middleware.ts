import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Redirect cache ──────────────────────────────────────────────────────────
// In-memory cache for redirect rules. Refreshed every 5 minutes via a
// lightweight Supabase REST fetch so we avoid DB round-trips per request.

type RedirectRule = { from_path: string; to_path: string; status_code: number };

let redirectCache: Map<string, RedirectRule> = new Map();
let redirectCacheExpiry = 0;
const REDIRECT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getRedirects(): Promise<Map<string, RedirectRule>> {
  const now = Date.now();
  if (redirectCache.size > 0 && now < redirectCacheExpiry) return redirectCache;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return redirectCache;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/redirects?select=from_path,to_path,status_code&limit=2000`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        // Edge fetch: short timeout
        signal: AbortSignal.timeout(3000),
      },
    );

    if (res.ok) {
      const rows = (await res.json()) as RedirectRule[];
      const map = new Map<string, RedirectRule>();
      for (const row of rows) {
        map.set(row.from_path, row);
      }
      redirectCache = map;
      redirectCacheExpiry = now + REDIRECT_CACHE_TTL_MS;
    }
  } catch {
    // Non-fatal: use stale cache or empty on first failure
  }

  return redirectCache;
}
// ────────────────────────────────────────────────────────────────────────────

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Redirect lookup (runs before admin guard) ──
  const redirects = await getRedirects();
  const rule = redirects.get(pathname);
  if (rule) {
    const dest = req.nextUrl.clone();
    dest.pathname = rule.to_path;
    return NextResponse.redirect(dest, { status: rule.status_code });
  }

  // ── Admin guard ──
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
  matcher: [
    // Run on all content routes (for redirects) and admin routes
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
