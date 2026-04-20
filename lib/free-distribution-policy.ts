import type { DistributionChannel } from '@/lib/distribution-engine';

const DEFAULT_FREE_API_CHANNELS: DistributionChannel[] = ['bluesky', 'reddit', 'newsletter', 'short_video'];
const ALL_CHANNELS: DistributionChannel[] = [
  'bluesky',
  'x',
  'linkedin',
  'instagram',
  'facebook',
  'reddit',
  'pinterest',
  'newsletter',
  'short_video',
  'affiliate_outreach',
];

function normalizeChannel(value: string | null | undefined): DistributionChannel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase() as DistributionChannel;
  return ALL_CHANNELS.includes(normalized) ? normalized : null;
}

export function getFreeApiChannels() {
  const raw = process.env.REACH_FREE_API_CHANNELS ?? process.env.FREE_DISTRIBUTION_CHANNELS ?? '';
  const configured = raw
    .split(',')
    .map((value) => normalizeChannel(value))
    .filter((value): value is DistributionChannel => Boolean(value));

  return configured.length > 0 ? Array.from(new Set(configured)) : DEFAULT_FREE_API_CHANNELS;
}

export function isFreeApiChannel(channel: string | null | undefined) {
  const normalized = normalizeChannel(channel);
  if (!normalized) return false;
  return getFreeApiChannels().includes(normalized);
}

export function getReachGoalForChannel(channel: string | null | undefined) {
  const normalized = normalizeChannel(channel);
  if (!normalized) return 'reach';
  return normalized === 'newsletter' ? 'owned_audience' : 'reach';
}

