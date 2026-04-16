import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'rs_admin';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function getSessionSecret() {
  const secret = process.env.ADMIN_PASSWORD?.trim();
  if (!secret) {
    throw new Error('Missing ADMIN_PASSWORD');
  }
  return secret;
}

function base64UrlEncode(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload: string) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAdminSessionCookieValue(now = Date.now()) {
  const payload = JSON.stringify({
    token: randomBytes(32).toString('hex'),
    exp: now + SESSION_TTL_SECONDS * 1000,
  });
  const encoded = base64UrlEncode(payload);
  const signature = signPayload(encoded);
  return `${encoded}.${signature}`;
}

export function verifyAdminSessionCookieValue(cookieValue: string | undefined, now = Date.now()) {
  if (!cookieValue) return false;

  const separatorIndex = cookieValue.lastIndexOf('.');
  if (separatorIndex <= 0) return false;

  const payload = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  if (!payload || !signature) return false;

  const expected = signPayload(payload);
  if (!safeCompare(signature, expected)) return false;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as { token?: unknown; exp?: unknown };
    return typeof decoded.token === 'string' && typeof decoded.exp === 'number' && decoded.exp > now;
  } catch {
    return false;
  }
}

export function getAdminSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    },
  };
}

export { COOKIE_NAME as ADMIN_SESSION_COOKIE_NAME };
