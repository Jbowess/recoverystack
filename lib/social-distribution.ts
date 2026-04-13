/**
 * Social media auto-distribution for newly published pages.
 *
 * Supports Twitter/X API v2 and LinkedIn Share API.
 * All functions no-op silently when required env vars are absent.
 *
 * Required env vars:
 *   Twitter: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 *   LinkedIn: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN (format: urn:li:person:XXXXXXX)
 */

import crypto from 'node:crypto';

const HASHTAG_MAP: Record<string, string[]> = {
  guides: ['#RecoveryStack', '#SportScience', '#AthleteRecovery'],
  alternatives: ['#WearableTech', '#SmartRing', '#RecoveryTech'],
  protocols: ['#RecoveryProtocol', '#SportsPerformance', '#AthleteTraining'],
  metrics: ['#HRV', '#SleepTracking', '#BiometricData'],
  costs: ['#RecoveryTech', '#WearableComparison', '#SmartRing'],
  compatibility: ['#WearableTech', '#RecoveryStack', '#FitnessTracker'],
  trends: ['#RecoveryTrends', '#SportsTech', '#AthletePerformance'],
  pillars: ['#RecoveryScience', '#SportScience', '#PerformanceOptimization'],
};

function buildOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const sigBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const sigKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const signature = crypto.createHmac('sha1', sigKey).update(sigBase).digest('base64');

  oauthParams.oauth_signature = signature;

  const headerValue = Object.keys(oauthParams)
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerValue}`;
}

export async function postToTwitter(
  title: string,
  url: string,
  template: string,
): Promise<void> {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return;

  const hashtags = (HASHTAG_MAP[template] ?? HASHTAG_MAP.guides).join(' ');
  // Truncate title if needed to fit 280 char limit (URL = 23 chars in Twitter)
  const maxTitleLen = 280 - 23 - 1 - hashtags.length - 2;
  const truncatedTitle = title.length > maxTitleLen ? `${title.slice(0, maxTitleLen - 1)}…` : title;
  const tweetText = `${truncatedTitle}\n${url}\n\n${hashtags}`;

  const endpoint = 'https://api.twitter.com/2/tweets';
  const body = JSON.stringify({ text: tweetText });

  try {
    const authHeader = buildOAuthHeader('POST', endpoint, {}, apiKey, apiSecret, accessToken, accessSecret);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) {
      console.warn(`[social] Twitter post failed ${res.status}: ${await res.text()}`);
      return;
    }

    console.log(`[social] Posted to Twitter: ${title.slice(0, 60)}`);
  } catch (err) {
    console.warn('[social] Twitter error:', err instanceof Error ? err.message : String(err));
  }
}

export async function postToLinkedIn(
  title: string,
  url: string,
  description: string,
): Promise<void> {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;

  if (!accessToken || !personUrn) return;

  const payload = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: `${title}\n\n${description.slice(0, 200)}` },
        shareMediaCategory: 'ARTICLE',
        media: [
          {
            status: 'READY',
            originalUrl: url,
            title: { text: title },
            description: { text: description.slice(0, 200) },
          },
        ],
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  try {
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`[social] LinkedIn post failed ${res.status}: ${await res.text()}`);
      return;
    }

    console.log(`[social] Posted to LinkedIn: ${title.slice(0, 60)}`);
  } catch (err) {
    console.warn('[social] LinkedIn error:', err instanceof Error ? err.message : String(err));
  }
}
