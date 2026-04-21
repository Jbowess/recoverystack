const INDEXNOW_ENDPOINT = process.env.INDEXNOW_ENDPOINT ?? 'https://api.indexnow.org/indexnow';

export async function submitUrlToIndexNow(url: string): Promise<void> {
  const key = process.env.INDEXNOW_KEY?.trim();
  const siteUrl = (process.env.SITE_URL ?? 'https://recoverystack.io').replace(/\/$/, '');

  if (!key) return;

  try {
    const host = new URL(siteUrl).host;
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl}/${key}.txt`,
        urlList: [url],
      }),
    });

    if (!res.ok) {
      console.warn(`[indexnow] Failed to submit ${url}: ${res.status} ${await res.text()}`);
      return;
    }

    console.log(`[indexnow] Submitted ${url}`);
  } catch (error) {
    console.warn(`[indexnow] Error submitting ${url}:`, error instanceof Error ? error.message : String(error));
  }
}
