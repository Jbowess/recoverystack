/**
 * Google Indexing API helper.
 *
 * Submits a URL to Google for immediate crawling after publish.
 * Uses the same service account JSON key as gsc-sync.ts.
 * No-ops silently when GSC_SERVICE_ACCOUNT_JSON is not set.
 *
 * Required scope: https://www.googleapis.com/auth/indexing
 * (must be granted in Google Search Console for the service account)
 */

async function getIndexingAccessToken(): Promise<string> {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON not set');

  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const scope = 'https://www.googleapis.com/auth/indexing';

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iss: key.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }),
  ).toString('base64url');

  const crypto = await import('node:crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(key.private_key, 'base64url');

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) throw new Error(`Indexing API token exchange failed ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Indexing API token response missing access_token');
  return json.access_token as string;
}

/**
 * Submit a URL to Google Indexing API for immediate crawling.
 * Uses type 'URL_UPDATED' — correct for both new pages and refreshed content.
 *
 * Silently no-ops when GSC_SERVICE_ACCOUNT_JSON is missing (dev/CI environments).
 */
export async function submitUrlToGoogle(url: string): Promise<void> {
  if (!process.env.GSC_SERVICE_ACCOUNT_JSON) return;

  try {
    const accessToken = await getIndexingAccessToken();

    const res = await fetch('https://indexingapi.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, type: 'URL_UPDATED' }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[indexing-api] Failed to submit ${url}: ${res.status} ${text}`);
      return;
    }

    console.log(`[indexing-api] Submitted ${url} for indexing`);
  } catch (err) {
    console.warn(`[indexing-api] Error submitting ${url}:`, err instanceof Error ? err.message : String(err));
  }
}
