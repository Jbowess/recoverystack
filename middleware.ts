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

function decodeBase64Url(input: string): string {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=').replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signPayload(payload: string): Promise<string | null> {
  const secret = process.env.ADMIN_PASSWORD?.trim();
  if (!secret) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const bytes = new Uint8Array(signature);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function validateAdminCookie(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;

  const separatorIndex = cookieValue.lastIndexOf('.');
  if (separatorIndex < 1) return false;

  const payload = cookieValue.slice(0, separatorIndex);
  const storedSignature = cookieValue.slice(separatorIndex + 1);
  if (!payload || !storedSignature) return false;

  const expectedSignature = await signPayload(payload);
  if (!expectedSignature || expectedSignature !== storedSignature) return false;

  try {
    const decoded = JSON.parse(decodeBase64Url(payload)) as { token?: unknown; exp?: unknown };
    return typeof decoded.token === 'string' && /^[0-9a-f]{64}$/.test(decoded.token) && typeof decoded.exp === 'number' && decoded.exp > Date.now();
  } catch {
    return false;
  }
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

  if (!(await validateAdminCookie(token))) {
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
