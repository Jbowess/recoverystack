import type { NewsSourceEvent, Storyline, TopicEntity } from '@/lib/types';

export const DEFAULT_NEWS_SOURCE_FEEDS = [
  {
    slug: 'oura-blog',
    name: 'Oura Blog',
    source_type: 'rss',
    beat: 'wearables',
    source_url: 'https://oura.rssing.com/chan-76706043/index-latest.php',
    site_url: 'https://oura.com',
    priority: 92,
  },
  {
    slug: 'whoop-press',
    name: 'WHOOP Press',
    source_type: 'rss',
    beat: 'wearables',
    source_url: 'https://www.whoop.com/us/en/thelocker/feed/',
    site_url: 'https://www.whoop.com',
    priority: 88,
  },
  {
    slug: 'garmin-news',
    name: 'Garmin Newsroom',
    source_type: 'rss',
    beat: 'wearables',
    source_url: 'https://www.garmin.com/en-US/blog/feed/',
    site_url: 'https://www.garmin.com',
    priority: 84,
  },
  {
    slug: 'eight-sleep-blog',
    name: 'Eight Sleep Blog',
    source_type: 'rss',
    beat: 'sleep_tech',
    source_url: 'https://www.eightsleep.com/blog/rss/',
    site_url: 'https://www.eightsleep.com',
    priority: 82,
  },
  {
    slug: 'pubmed-sleep',
    name: 'PubMed Sleep Research',
    source_type: 'rss',
    beat: 'sleep_science',
    source_url: 'https://pubmed.ncbi.nlm.nih.gov/rss/search/1gQx1kP4XgYvKjz2m2jR4K8m7o2W9rL0f9qB9g3bP8F1g6t1/?limit=20&utm_campaign=pubmed-2&fc=20250101000000',
    site_url: 'https://pubmed.ncbi.nlm.nih.gov',
    priority: 90,
  },
  {
    slug: 'fda-medical-devices',
    name: 'FDA Medical Devices Recalls',
    source_type: 'rss',
    beat: 'regulatory',
    source_url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medical-device-recalls/rss.xml',
    site_url: 'https://www.fda.gov',
    priority: 86,
  },
  {
    slug: 'therabody-blog',
    name: 'Therabody Blog',
    source_type: 'rss',
    beat: 'recovery_devices',
    source_url: 'https://www.therabody.com/us/en-us/blog?format=rss',
    site_url: 'https://www.therabody.com',
    priority: 78,
  },
  {
    slug: 'hyperice-blog',
    name: 'Hyperice Blog',
    source_type: 'rss',
    beat: 'recovery_devices',
    source_url: 'https://hyperice.com/blogs/articles.atom',
    site_url: 'https://hyperice.com',
    priority: 76,
  },
] as const;

export const NEWS_EVENT_TYPE_PATTERNS: Array<{ pattern: RegExp; eventType: string; beat?: string }> = [
  { pattern: /\b(?:launch|released|unveils|announces|introduces)\b/i, eventType: 'product_launch', beat: 'wearables' },
  { pattern: /\b(?:firmware|software update|app update|version)\b/i, eventType: 'product_update', beat: 'wearables' },
  { pattern: /\b(?:study|trial|meta-analysis|research|published)\b/i, eventType: 'research_publication', beat: 'sleep_science' },
  { pattern: /\b(?:funding|raises|series a|series b|acquires|acquisition|partnership)\b/i, eventType: 'company_move', beat: 'industry' },
  { pattern: /\b(?:recall|fda|warning|safety)\b/i, eventType: 'regulatory_update', beat: 'regulatory' },
  { pattern: /\b(?:price|pricing|subscription)\b/i, eventType: 'pricing_update', beat: 'commerce' },
];

export const ENTITY_SEEDS: Array<{ canonical_name: string; slug: string; entity_type: string; beat: string; aliases: string[]; site_url?: string }> = [
  { canonical_name: 'Oura', slug: 'oura', entity_type: 'brand', beat: 'wearables', aliases: ['oura', 'oura ring'], site_url: 'https://oura.com' },
  { canonical_name: 'WHOOP', slug: 'whoop', entity_type: 'brand', beat: 'wearables', aliases: ['whoop'], site_url: 'https://www.whoop.com' },
  { canonical_name: 'Garmin', slug: 'garmin', entity_type: 'brand', beat: 'wearables', aliases: ['garmin'], site_url: 'https://www.garmin.com' },
  { canonical_name: 'Apple Watch', slug: 'apple-watch', entity_type: 'product', beat: 'wearables', aliases: ['apple watch', 'watchos'], site_url: 'https://www.apple.com/watch' },
  { canonical_name: 'Samsung Galaxy Ring', slug: 'samsung-galaxy-ring', entity_type: 'product', beat: 'wearables', aliases: ['galaxy ring', 'samsung ring'], site_url: 'https://www.samsung.com' },
  { canonical_name: 'Ultrahuman Ring', slug: 'ultrahuman-ring', entity_type: 'product', beat: 'wearables', aliases: ['ultrahuman', 'ultrahuman ring'], site_url: 'https://www.ultrahuman.com' },
  { canonical_name: 'Eight Sleep', slug: 'eight-sleep', entity_type: 'brand', beat: 'sleep_tech', aliases: ['eight sleep', 'pod'], site_url: 'https://www.eightsleep.com' },
  { canonical_name: 'Therabody', slug: 'therabody', entity_type: 'brand', beat: 'recovery_devices', aliases: ['therabody', 'theragun'], site_url: 'https://www.therabody.com' },
  { canonical_name: 'Hyperice', slug: 'hyperice', entity_type: 'brand', beat: 'recovery_devices', aliases: ['hyperice', 'normatec'], site_url: 'https://hyperice.com' },
  { canonical_name: 'HRV', slug: 'hrv', entity_type: 'metric', beat: 'sleep_science', aliases: ['hrv', 'heart rate variability'] },
  { canonical_name: 'VO2 Max', slug: 'vo2-max', entity_type: 'metric', beat: 'fitness_metrics', aliases: ['vo2 max', 'vo2max'] },
  { canonical_name: 'CGM', slug: 'cgm', entity_type: 'device_category', beat: 'metabolic_health', aliases: ['cgm', 'continuous glucose monitor'] },
] as const;

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const STORYLINE_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'after',
  'about',
  'what',
  'need',
  'know',
  'your',
  'their',
  'have',
  'will',
  'says',
  'report',
  'latest',
  'new',
  'launch',
  'released',
]);

export function scoreAuthorityFromDomain(domain: string | null) {
  const value = (domain ?? '').toLowerCase();
  if (!value) return 50;
  if (value.includes('nih.gov') || value.includes('pubmed') || value.includes('fda.gov')) return 96;
  if (value.includes('.gov')) return 90;
  if (value.includes('.edu')) return 88;
  if (value.includes('nature.com') || value.includes('thelancet.com') || value.includes('jamanetwork.com')) return 94;
  if (value.includes('apple.com') || value.includes('garmin.com') || value.includes('oura.com') || value.includes('whoop.com')) return 82;
  return 62;
}

export function inferEventType(title: string, summary?: string | null) {
  const haystack = `${title} ${summary ?? ''}`;
  for (const rule of NEWS_EVENT_TYPE_PATTERNS) {
    if (rule.pattern.test(haystack)) {
      return { eventType: rule.eventType, beat: rule.beat ?? 'general_recovery' };
    }
  }
  return { eventType: 'news_update', beat: 'general_recovery' };
}

export function inferFreshnessScore(publishedAt: string | null | undefined) {
  if (!publishedAt) return 45;
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60));
  if (ageHours <= 12) return 96;
  if (ageHours <= 24) return 88;
  if (ageHours <= 48) return 80;
  if (ageHours <= 168) return 65;
  return 45;
}

export function computeSignificanceScore(event: Pick<NewsSourceEvent, 'relevance_score' | 'authority_score' | 'freshness_score' | 'extraction'>) {
  const extraction = event.extraction ?? {};
  const claimCount = Array.isArray(extraction.key_claims) ? extraction.key_claims.length : 0;
  const factCount = Array.isArray(extraction.known_facts) ? extraction.known_facts.length : 0;
  const quoteCount = Array.isArray(extraction.quotes) ? extraction.quotes.length : 0;
  const raw =
    event.relevance_score * 0.4 +
    event.authority_score * 0.25 +
    event.freshness_score * 0.25 +
    Math.min(10, claimCount * 2 + factCount + quoteCount);
  return Math.max(1, Math.min(100, Math.round(raw)));
}

export function tokenizeStorylineText(value: string): string[] {
  return normalizeToken(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STORYLINE_STOP_WORDS.has(token))
    .slice(0, 12);
}

export function buildEventClusteringKey(
  event: Pick<NewsSourceEvent, 'title' | 'event_type' | 'beat'>,
  entities: TopicEntity[],
): string {
  const leadEntity = entities[0]?.slug ?? 'no-entity';
  const topical = tokenizeStorylineText(event.title).slice(0, 4).join('-') || 'generic';
  return [leadEntity, event.event_type || 'news-update', event.beat || 'general', topical]
    .join('::')
    .slice(0, 180);
}

export function calculateTokenOverlap(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  return intersection / Math.max(left.size, right.size);
}

export function extractEntityMatches(text: string, entities: Array<Pick<TopicEntity, 'id' | 'slug' | 'canonical_name' | 'entity_type' | 'beat' | 'metadata'>>): TopicEntity[] {
  const haystack = normalizeToken(text);
  const out: TopicEntity[] = [];
  for (const entity of entities) {
    const aliases = Array.isArray(entity.metadata?.aliases) ? entity.metadata?.aliases : [];
    const candidates = [entity.canonical_name, ...aliases.map((item) => String(item))];
    if (candidates.some((candidate) => haystack.includes(normalizeToken(candidate)))) {
      out.push({
        id: entity.id,
        slug: entity.slug,
        canonical_name: entity.canonical_name,
        entity_type: entity.entity_type,
        beat: entity.beat,
        authority_score: 0,
        confidence_score: 80,
        metadata: entity.metadata ?? null,
      });
    }
  }
  return out;
}

export function buildStorylineSlug(event: Pick<NewsSourceEvent, 'title' | 'event_type'>, entities: TopicEntity[]) {
  const base = entities[0]?.slug ?? event.title;
  return normalizeToken(`${base} ${event.event_type}`).replace(/\s+/g, '-').slice(0, 90);
}

export function buildStorylineTitle(event: Pick<NewsSourceEvent, 'title'>, entities: TopicEntity[]) {
  if (entities[0]) return `${entities[0].canonical_name}: ${event.title}`;
  return event.title;
}

export function buildNewsroomContext(params: {
  storyline: Storyline | null;
  sourceEvents: NewsSourceEvent[];
  entities: TopicEntity[];
}) {
  const sortedEvents = [...params.sourceEvents].sort((a, b) => {
    const aTime = new Date(a.published_at ?? 0).getTime();
    const bTime = new Date(b.published_at ?? 0).getTime();
    return bTime - aTime;
  });

  const storySummary = params.storyline?.summary
    ?? sortedEvents[0]?.summary
    ?? sortedEvents[0]?.title
    ?? null;

  return {
    story_summary: storySummary ?? undefined,
    what_changed: sortedEvents.slice(0, 3).map((event) => event.title),
    known_facts: sortedEvents
      .flatMap((event) => {
        const extractedFacts = Array.isArray(event.extraction?.known_facts)
          ? event.extraction?.known_facts.map((item) => String(item))
          : [];
        return extractedFacts.length ? extractedFacts : [event.summary ?? event.title];
      })
      .filter(Boolean)
      .slice(0, 6),
    key_claims: sortedEvents
      .flatMap((event) => {
        const claims = Array.isArray(event.extraction?.key_claims)
          ? event.extraction?.key_claims.map((item) => String(item))
          : [];
        return claims;
      })
      .filter(Boolean)
      .slice(0, 6),
    what_we_do_not_know_yet: sortedEvents
      .flatMap((event) => {
        const unknowns = Array.isArray(event.extraction?.unknowns)
          ? event.extraction?.unknowns.map((item) => String(item))
          : [];
        return unknowns;
      })
      .filter(Boolean)
      .slice(0, 4),
    timeline: sortedEvents
      .flatMap((event) => {
        const timeline = Array.isArray(event.extraction?.timeline)
          ? event.extraction.timeline
          : [];
        return timeline
          .filter((item): item is { label?: unknown; date?: unknown } => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            label: String(item.label ?? '').trim(),
            date: typeof item.date === 'string' ? item.date : null,
          }))
          .filter((item) => item.label);
      })
      .slice(0, 6),
    source_categories: Array.from(
      new Set(
        sortedEvents
          .map((event) => event.metadata?.source_label)
          .filter((item): item is string => typeof item === 'string' && item.length > 0),
      ),
    ),
    source_events: sortedEvents.slice(0, 5),
    storyline: params.storyline,
    entities: params.entities,
  };
}
