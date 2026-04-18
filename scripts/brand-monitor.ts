import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { buildNewsExtractionBundle } from '@/lib/article-intelligence';
import { computeSignificanceScore, inferEventType, inferFreshnessScore, scoreAuthorityFromDomain } from '@/lib/newsroom';
import { assessTrendRelevance } from '@/lib/trend-relevance';
import { DEFAULT_WATCHLIST_SEEDS } from '@/lib/watchlists';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

type WatchlistRow = {
  id: string;
  entity_id: string | null;
  slug: string;
  label: string;
  watch_type: string;
  beat: string;
  source_url: string | null;
  query: string | null;
  cadence: string;
  priority: number;
  active: boolean;
  metadata: Record<string, unknown> | null;
};

function extractItems(xml: string): string[] {
  return xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
}

function extractTag(itemXml: string, tag: string): string | null {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeTitle(value: string): string {
  return decodeEntities(stripHtml(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function buildEventKey(watchlistSlug: string, url: string, title: string): string {
  return createHash('sha256')
    .update(`watch:${watchlistSlug}::${url}::${normalizeTitle(title)}`)
    .digest('hex');
}

function buildHitKey(watchlistSlug: string, url: string, title: string): string {
  return createHash('sha256')
    .update(`hit:${watchlistSlug}::${url}::${normalizeTitle(title)}`)
    .digest('hex');
}

function inferDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function buildGoogleNewsUrl(query: string) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  return url.toString();
}

async function ensureWatchlists() {
  const { data: entities } = await supabase.from('topic_entities').select('id,slug').eq('active', true);
  const entityBySlug = new Map((entities ?? []).map((row: any) => [String(row.slug), String(row.id)]));

  const rows = DEFAULT_WATCHLIST_SEEDS.map((seed) => ({
    entity_id: seed.entity_slug ? entityBySlug.get(seed.entity_slug) ?? null : null,
    slug: seed.slug,
    label: seed.label,
    watch_type: seed.watch_type,
    beat: seed.beat,
    source_url: seed.source_url ?? null,
    query: seed.query ?? null,
    cadence: seed.cadence,
    priority: seed.priority,
    active: true,
    metadata: seed.metadata ?? {},
  }));

  const { error } = await supabase.from('source_watchlists').upsert(rows, { onConflict: 'slug' });
  if (error) throw error;
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'recoverystack-watchlist-monitor/1.0',
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
        'User-Agent': 'recoverystack-watchlist-monitor/1.0 (+article extraction)',
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

async function ingestWatchlist(watchlist: WatchlistRow) {
  const feedUrl = watchlist.source_url ?? (watchlist.query ? buildGoogleNewsUrl(watchlist.query) : null);
  if (!feedUrl) return 0;

  const xml = await fetchText(feedUrl);
  const items = extractItems(xml);
  let inserted = 0;

  for (const item of items.slice(0, 20)) {
    const title = extractTag(item, 'title');
    const rawUrl = extractTag(item, 'link') ?? extractTag(item, 'guid');
    const summary = extractTag(item, 'description') ?? extractTag(item, 'summary') ?? extractTag(item, 'content');
    const publishedAt = extractTag(item, 'pubDate') ?? extractTag(item, 'updated') ?? extractTag(item, 'published');
    if (!title || !rawUrl) continue;

    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) continue;

    const relevanceText = `${title} ${summary ?? ''} ${watchlist.label}`;
    const relevance = assessTrendRelevance(relevanceText, 'rss');
    if (!relevance.relevant && watchlist.watch_type !== 'brand' && watchlist.watch_type !== 'research' && watchlist.watch_type !== 'regulatory') {
      continue;
    }

    const html = await fetchArticleHtml(rawUrl);
    const bundle = buildNewsExtractionBundle({
      html,
      url: rawUrl,
      title,
      summary,
      sourceType: watchlist.watch_type,
    });
    const canonicalUrl = typeof bundle.extraction.canonical_url === 'string' ? bundle.extraction.canonical_url : rawUrl;
    const sourceDomain = typeof bundle.extraction.source_domain === 'string'
      ? bundle.extraction.source_domain
      : inferDomain(canonicalUrl);
    const effectivePublishedAt =
      (typeof bundle.extraction.article_published_at === 'string' ? bundle.extraction.article_published_at : null)
      ?? (publishedAt ? new Date(publishedAt).toISOString() : null);
    const freshnessScore = inferFreshnessScore(effectivePublishedAt);
    const authorityScore = Math.max(scoreAuthorityFromDomain(sourceDomain), Math.min(95, watchlist.priority));
    const inferred = inferEventType(
      title,
      `${summary ?? ''} ${typeof bundle.extraction.extracted_text === 'string' ? bundle.extraction.extracted_text.slice(0, 1200) : ''}`.trim(),
    );
    const relevanceScore = Math.max(1, Math.min(100, relevance.score * 10 + Math.round(watchlist.priority / 5)));
    const significanceScore = computeSignificanceScore({
      relevance_score: relevanceScore,
      authority_score: authorityScore,
      freshness_score: freshnessScore,
      extraction: bundle.extraction,
    });
    const eventKey = buildEventKey(watchlist.slug, rawUrl, title);
    const hitKey = buildHitKey(watchlist.slug, rawUrl, title);

    if (isDryRun) {
      inserted += 1;
      continue;
    }

    const { data: eventRow, error } = await supabase
      .from('news_source_events')
      .upsert(
        {
          feed_id: null,
          source_type: `watchlist_${watchlist.watch_type}`,
          beat: inferred.beat ?? watchlist.beat,
          event_key: eventKey,
          title: decodeEntities(stripHtml(title)),
          normalized_title: normalizedTitle,
          summary: summary ? decodeEntities(stripHtml(summary)).slice(0, 500) : null,
          url: canonicalUrl,
          source_domain: sourceDomain,
          published_at: effectivePublishedAt,
          event_type: inferred.eventType,
          relevance_score: relevanceScore,
          authority_score: authorityScore,
          freshness_score: freshnessScore,
          significance_score: significanceScore,
          status: freshnessScore >= 80 ? 'ready' : 'new',
          source_payload: {
            watchlist_slug: watchlist.slug,
            watchlist_label: watchlist.label,
            raw_title: title,
            raw_summary: summary,
          },
          extraction: bundle.extraction,
          clustering_key: `${watchlist.slug}:${inferred.eventType}:${normalizedTitle.slice(0, 80)}`,
          metadata: {
            ...bundle.metadata,
            watchlist_slug: watchlist.slug,
            watch_type: watchlist.watch_type,
          },
        },
        { onConflict: 'event_key' },
      )
      .select('id')
      .single();

    if (error) continue;

    await supabase.from('source_watchlist_hits').upsert(
      {
        watchlist_id: watchlist.id,
        event_id: eventRow?.id ?? null,
        hit_key: hitKey,
        matched_term: watchlist.query ?? watchlist.label,
        confidence_score: Math.min(100, Math.max(60, significanceScore)),
        metadata: {
          url: canonicalUrl,
          source_domain: sourceDomain,
        },
      },
      { onConflict: 'hit_key' },
    );

    await supabase
      .from('source_watchlists')
      .update({
        last_checked_at: new Date().toISOString(),
        last_hit_at: new Date().toISOString(),
      })
      .eq('id', watchlist.id);

    inserted += 1;
  }

  return inserted;
}

async function run() {
  await ensureWatchlists();

  const { data, error } = await supabase
    .from('source_watchlists')
    .select('id,entity_id,slug,label,watch_type,beat,source_url,query,cadence,priority,active,metadata')
    .eq('active', true)
    .order('priority', { ascending: false });

  if (error) throw error;

  let totalInserted = 0;
  for (const watchlist of (data ?? []) as WatchlistRow[]) {
    try {
      const inserted = await ingestWatchlist(watchlist);
      totalInserted += inserted;
      console.log(`[brand-monitor] ${watchlist.slug}: ${inserted} event(s)`);
    } catch (error) {
      console.warn(`[brand-monitor] ${watchlist.slug}:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`[brand-monitor] Done. processed=${(data ?? []).length} inserted=${totalInserted} dryRun=${isDryRun}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
