import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { buildNewsExtractionBundle } from '@/lib/article-intelligence';
import {
  DEFAULT_NEWS_SOURCE_FEEDS,
  computeSignificanceScore,
  inferEventType,
  inferFreshnessScore,
  scoreAuthorityFromDomain,
} from '@/lib/newsroom';
import { assessTrendRelevance } from '@/lib/trend-relevance';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type FeedRow = {
  id: string;
  slug: string;
  name: string;
  source_type: string;
  beat: string;
  source_url: string;
  site_url: string | null;
  priority: number;
  active: boolean;
};

function extractItems(xml: string): string[] {
  return xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
}

function extractTag(itemXml: string, tag: string): string | null {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTitle(value: string) {
  return decodeEntities(stripHtml(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function inferUrlDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function buildEventKey(feedSlug: string, url: string, title: string) {
  return createHash('sha256')
    .update(`${feedSlug}::${url}::${normalizeTitle(title)}`)
    .digest('hex');
}

async function ensureFeedSeed() {
  const rows = DEFAULT_NEWS_SOURCE_FEEDS.map((feed) => ({
    ...feed,
    active: true,
    metadata: {},
  }));

  const { error } = await supabase.from('news_source_feeds').upsert(rows, {
    onConflict: 'slug',
  });

  if (error) throw error;
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'recoverystack-news-intake/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

async function fetchArticleHtml(url: string) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'recoverystack-news-intake/1.0 (+article extraction)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/html|xml/i.test(contentType)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function buildClusteringKey(beat: string, eventType: string, normalizedTitle: string) {
  return `${beat}:${eventType}:${normalizedTitle.slice(0, 80)}`;
}

async function ingestFeed(feed: FeedRow) {
  const xml = await fetchText(feed.source_url);
  const items = extractItems(xml);
  let inserted = 0;

  for (const item of items.slice(0, 25)) {
    const title = extractTag(item, 'title');
    if (!title) continue;

    const rawUrl =
      extractTag(item, 'link')
      ?? item.match(/<link[^>]+href="([^"]+)"/i)?.[1]
      ?? extractTag(item, 'guid');
    if (!rawUrl) continue;

    const summary = extractTag(item, 'description') ?? extractTag(item, 'summary');
    const publishedAt = extractTag(item, 'pubDate') ?? extractTag(item, 'published') ?? extractTag(item, 'updated');
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) continue;

    const relevance = assessTrendRelevance(`${title} ${summary ?? ''}`, 'rss');
    if (!relevance.relevant) continue;

    const html = await fetchArticleHtml(rawUrl);
    const bundle = buildNewsExtractionBundle({
      html,
      url: rawUrl,
      title,
      summary,
      sourceType: feed.source_type,
    });

    const canonicalUrl = typeof bundle.extraction.canonical_url === 'string' ? bundle.extraction.canonical_url : rawUrl;
    const domain = typeof bundle.extraction.source_domain === 'string'
      ? bundle.extraction.source_domain
      : inferUrlDomain(canonicalUrl);
    const authorityScore = scoreAuthorityFromDomain(domain);
    const effectivePublishedAt =
      (typeof bundle.extraction.article_published_at === 'string' ? bundle.extraction.article_published_at : null)
      ?? (publishedAt ? new Date(publishedAt).toISOString() : null);
    const freshnessScore = inferFreshnessScore(effectivePublishedAt);
    const inferred = inferEventType(
      title,
      `${summary ?? ''} ${typeof bundle.extraction.extracted_text === 'string' ? bundle.extraction.extracted_text.slice(0, 1400) : ''}`.trim(),
    );
    const relevanceScore = Math.max(1, Math.min(100, relevance.score * 10 + Math.round(feed.priority / 4)));
    const significanceScore = computeSignificanceScore({
      relevance_score: relevanceScore,
      authority_score: authorityScore,
      freshness_score: freshnessScore,
      extraction: bundle.extraction,
    });

    const { error } = await supabase.from('news_source_events').upsert(
      {
        feed_id: feed.id,
        source_type: feed.source_type,
        beat: inferred.beat ?? feed.beat,
        event_key: buildEventKey(feed.slug, rawUrl, title),
        title: decodeEntities(stripHtml(title)),
        normalized_title: normalizedTitle,
        summary: summary ? decodeEntities(stripHtml(summary)).slice(0, 500) : null,
        url: canonicalUrl,
        source_domain: domain,
        published_at: effectivePublishedAt,
        event_type: inferred.eventType,
        relevance_score: relevanceScore,
        authority_score: authorityScore,
        freshness_score: freshnessScore,
        significance_score: significanceScore,
        status: freshnessScore >= 80 ? 'ready' : 'new',
        source_payload: {
          raw_title: title,
          raw_summary: summary,
          article_fetched: Boolean(html),
        },
        extraction: bundle.extraction,
        clustering_key: buildClusteringKey(inferred.beat ?? feed.beat, inferred.eventType, normalizedTitle),
        metadata: {
          matches: relevance.matches,
          blocked_by: relevance.blockedBy,
          feed_slug: feed.slug,
          ...bundle.metadata,
        },
      },
      { onConflict: 'event_key' },
    );

    if (!error) inserted += 1;
  }

  await supabase
    .from('news_source_feeds')
    .update({ last_polled_at: new Date().toISOString(), last_success_at: new Date().toISOString() })
    .eq('id', feed.id);

  console.log(`[news-intake] ${feed.slug}: processed ${Math.min(items.length, 25)} item(s), upserted ${inserted}`);
}

const PREPRINT_FEEDS = [
  {
    name: 'bioRxiv Sports Medicine',
    url: 'https://www.biorxiv.org/rss/category/sports-medicine+and+performance',
    beat: 'recovery_protocols',
    source_domain: 'biorxiv.org',
  },
  {
    name: 'bioRxiv Physiology',
    url: 'https://www.biorxiv.org/rss/category/physiology',
    beat: 'sleep_science',
    source_domain: 'biorxiv.org',
  },
  {
    name: 'medRxiv Sports Medicine',
    url: 'https://www.medrxiv.org/rss/category/sports-medicine',
    beat: 'recovery_protocols',
    source_domain: 'medrxiv.org',
  },
  {
    name: 'medRxiv Sleep Disorders',
    url: 'https://www.medrxiv.org/rss/category/sleep-disorders',
    beat: 'sleep_science',
    source_domain: 'medrxiv.org',
  },
  {
    name: 'medRxiv Wearable Technology',
    url: 'https://www.medrxiv.org/rss/category/health-informatics',
    beat: 'wearables',
    source_domain: 'medrxiv.org',
  },
] as const;

async function ingestPreprintFeeds(): Promise<void> {
  let totalInserted = 0;

  for (const feed of PREPRINT_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          'User-Agent': 'recoverystack-news-intake/1.0 (+preprint monitoring)',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        },
      });

      if (!res.ok) {
        console.warn(`[preprints] ${feed.name}: fetch failed (${res.status})`);
        continue;
      }

      const xml = await res.text();
      const items = extractItems(xml);
      let inserted = 0;

      for (const item of items.slice(0, 20)) {
        const title = extractTag(item, 'title');
        const rawUrl = extractTag(item, 'link') ?? extractTag(item, 'guid');
        const summary = extractTag(item, 'description') ?? extractTag(item, 'dc:description');
        const publishedAt = extractTag(item, 'pubDate') ?? extractTag(item, 'dc:date');
        const authors = extractTag(item, 'dc:creator');

        if (!title || !rawUrl) continue;

        const normalizedTitle = normalizeTitle(title);
        if (!normalizedTitle) continue;

        const relevance = assessTrendRelevance(`${title} ${summary ?? ''}`, 'rss');
        if (!relevance.relevant) continue;

        const html = await fetchArticleHtml(rawUrl);
        const bundle = buildNewsExtractionBundle({
          html,
          url: rawUrl,
          title,
          summary,
          sourceType: 'research',
        });
        const canonicalUrl = typeof bundle.extraction.canonical_url === 'string' ? bundle.extraction.canonical_url : rawUrl;
        const effectivePublishedAt =
          (typeof bundle.extraction.article_published_at === 'string' ? bundle.extraction.article_published_at : null)
          ?? (publishedAt ? new Date(publishedAt).toISOString() : null);
        const freshnessScore = inferFreshnessScore(effectivePublishedAt);
        const authorityScore = feed.source_domain === 'medrxiv.org' ? 75 : 70;
        const inferred = inferEventType(
          title,
          `${summary ?? ''} ${typeof bundle.extraction.extracted_text === 'string' ? bundle.extraction.extracted_text.slice(0, 1400) : ''}`.trim(),
        );
        const relevanceScore = Math.max(1, Math.min(100, relevance.score * 10 + 10));
        const significanceScore = computeSignificanceScore({
          relevance_score: relevanceScore,
          authority_score: authorityScore,
          freshness_score: freshnessScore,
          extraction: bundle.extraction,
        });

        const eventKey = `preprint:${feed.source_domain}:${Buffer.from(rawUrl).toString('base64').slice(0, 32)}`;

        const { error } = await supabase.from('news_source_events').upsert(
          {
            source_type: 'research',
            beat: inferred.beat ?? feed.beat,
            event_key: eventKey,
            title: decodeEntities(stripHtml(title)),
            normalized_title: normalizedTitle,
            summary: summary ? `[PREPRINT - not peer reviewed] ${decodeEntities(stripHtml(summary)).slice(0, 480)}` : null,
            url: canonicalUrl,
            source_domain: feed.source_domain,
            published_at: effectivePublishedAt,
            event_type: 'research',
            relevance_score: relevanceScore,
            authority_score: authorityScore,
            freshness_score: freshnessScore,
            significance_score: significanceScore,
            status: freshnessScore >= 80 ? 'ready' : 'new',
            source_payload: {
              raw_title: title,
              raw_summary: summary,
              authors,
              preprint: true,
              server: feed.source_domain,
              article_fetched: Boolean(html),
            },
            extraction: {
              ...bundle.extraction,
              preprint: true,
            },
            clustering_key: buildClusteringKey(inferred.beat ?? feed.beat, 'research', normalizedTitle),
            metadata: {
              matches: relevance.matches,
              feed_name: feed.name,
              preprint: true,
              ...bundle.metadata,
            },
          },
          { onConflict: 'event_key' },
        );

        if (!error) {
          inserted += 1;
          totalInserted += 1;
        }
      }

      console.log(`[preprints] ${feed.name}: processed ${Math.min(items.length, 20)} item(s), upserted ${inserted}`);
    } catch (error) {
      console.warn(`[preprints] ${feed.name}: error (non-fatal):`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`[preprints] complete. total upserted: ${totalInserted}`);
}

async function run() {
  await ensureFeedSeed();

  const { data, error } = await supabase
    .from('news_source_feeds')
    .select('id,slug,name,source_type,beat,source_url,site_url,priority,active')
    .eq('active', true)
    .order('priority', { ascending: false });

  if (error) throw error;

  for (const feed of (data ?? []) as FeedRow[]) {
    try {
      await ingestFeed(feed);
    } catch (error) {
      console.warn(`[news-intake] ${feed.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await ingestPreprintFeeds();

  const { count } = await supabase
    .from('news_source_events')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'ready']);

  console.log(`[news-intake] complete. candidate source events: ${count ?? 0}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
