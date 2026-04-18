import { ENTITY_SEEDS } from '@/lib/newsroom';

export type WatchlistSeed = {
  slug: string;
  label: string;
  entity_slug?: string;
  watch_type: 'brand' | 'regulatory' | 'research' | 'product' | 'topic';
  beat: string;
  source_url?: string | null;
  query?: string | null;
  cadence: 'hourly' | 'daily' | 'weekly';
  priority: number;
  metadata?: Record<string, unknown>;
};

const brandSeeds: WatchlistSeed[] = ENTITY_SEEDS
  .filter((entity) => entity.entity_type === 'brand' || entity.entity_type === 'product')
  .map((entity) => ({
    slug: `watch-${entity.slug}`,
    label: entity.canonical_name,
    entity_slug: entity.slug,
    watch_type: entity.entity_type === 'product' ? 'product' : 'brand',
    beat: entity.beat,
    source_url: entity.site_url ?? null,
    query: `${entity.canonical_name} recovery OR wearable OR health`,
    cadence: 'daily',
    priority: entity.entity_type === 'brand' ? 88 : 82,
    metadata: {
      aliases: entity.aliases,
      site_url: entity.site_url ?? null,
    },
  }));

export const DEFAULT_WATCHLIST_SEEDS: WatchlistSeed[] = [
  ...brandSeeds,
  {
    slug: 'watch-fda-devices',
    label: 'FDA Medical Devices',
    watch_type: 'regulatory',
    beat: 'regulatory',
    source_url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medical-device-recalls/rss.xml',
    query: 'FDA medical device recall wearable sleep recovery',
    cadence: 'daily',
    priority: 95,
  },
  {
    slug: 'watch-pubmed-sleep',
    label: 'PubMed Sleep Research',
    watch_type: 'research',
    beat: 'sleep_science',
    source_url: 'https://pubmed.ncbi.nlm.nih.gov/rss/search/1gQx1kP4XgYvKjz2m2jR4K8m7o2W9rL0f9qB9g3bP8F1g6t1/?limit=20&utm_campaign=pubmed-2&fc=20250101000000',
    query: 'sleep research wearable recovery HRV',
    cadence: 'daily',
    priority: 92,
  },
  {
    slug: 'watch-biorxiv-performance',
    label: 'bioRxiv Sports Medicine',
    watch_type: 'research',
    beat: 'recovery_protocols',
    source_url: 'https://www.biorxiv.org/rss/category/sports-medicine+and+performance',
    query: 'sports medicine performance recovery wearable',
    cadence: 'daily',
    priority: 89,
  },
  {
    slug: 'watch-smart-rings',
    label: 'Smart Ring Topic',
    watch_type: 'topic',
    beat: 'wearables',
    query: '"smart ring" wearable health recovery',
    cadence: 'daily',
    priority: 84,
    metadata: { aliases: ['smart ring', 'recovery ring', 'health ring'] },
  },
];
