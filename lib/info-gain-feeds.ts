import type { PageBodySection } from '@/lib/types';

type ScientificAlphaItem = {
  title: string;
  journal: string | null;
  pubdate: string | null;
  url: string;
};

type SocialComplaintItem = {
  title: string;
  subreddit: string;
  score: number | null;
  comments: number | null;
  url: string;
};

type RetailerPriceSnapshot = {
  retailer: string;
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  url: string | null;
  captured_at: string;
};

export type InfoGainFeeds = {
  scientific_alpha?: {
    source: 'pubmed';
    query: string;
    captured_at: string;
    items: ScientificAlphaItem[];
  };
  social_sentiment?: {
    source: 'reddit';
    query: string;
    captured_at: string;
    complaints: SocialComplaintItem[];
  };
  price_performance?: {
    source: 'retailer_snapshot';
    captured_at: string;
    snapshots: RetailerPriceSnapshot[];
    note?: string;
  };
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((result) => resolve(result))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

async function fetchPubMedScientificAlpha(keyword: string): Promise<InfoGainFeeds['scientific_alpha'] | undefined> {
  if (!keyword?.trim()) return undefined;

  const query = `${keyword} recovery OR athlete`;
  const searchUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
  searchUrl.searchParams.set('db', 'pubmed');
  searchUrl.searchParams.set('retmode', 'json');
  searchUrl.searchParams.set('retmax', '4');
  searchUrl.searchParams.set('sort', 'relevance');
  searchUrl.searchParams.set('term', query);

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': 'recoverystack-info-feeds/1.0' },
  });
  if (!searchRes.ok) return undefined;

  const searchJson = await searchRes.json();
  const ids: string[] = searchJson?.esearchresult?.idlist ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return undefined;

  const summaryUrl = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
  summaryUrl.searchParams.set('db', 'pubmed');
  summaryUrl.searchParams.set('retmode', 'json');
  summaryUrl.searchParams.set('id', ids.join(','));

  const summaryRes = await fetch(summaryUrl.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': 'recoverystack-info-feeds/1.0' },
  });
  if (!summaryRes.ok) return undefined;

  const summaryJson = await summaryRes.json();
  const items: ScientificAlphaItem[] = ids
    .map((id) => {
      const row = summaryJson?.result?.[id];
      if (!row?.title) return null;
      return {
        title: String(row.title),
        journal: row.fulljournalname ? String(row.fulljournalname) : null,
        pubdate: row.pubdate ? String(row.pubdate) : null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      };
    })
    .filter((x): x is ScientificAlphaItem => Boolean(x));

  if (!items.length) return undefined;

  return {
    source: 'pubmed',
    query,
    captured_at: new Date().toISOString(),
    items,
  };
}

async function fetchRedditComplaintSnapshot(keyword: string): Promise<InfoGainFeeds['social_sentiment'] | undefined> {
  if (!keyword?.trim()) return undefined;

  const complaintTerms = ['pain', 'problem', 'issue', 'bad', 'broken', 'not working', 'worse'];
  const complaintQuery = `${keyword} (${complaintTerms.join(' OR ')})`;
  const url = new URL('https://www.reddit.com/search.json');
  url.searchParams.set('q', complaintQuery);
  url.searchParams.set('sort', 'new');
  url.searchParams.set('limit', '6');
  url.searchParams.set('type', 'link');

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'recoverystack-info-feeds/1.0',
    },
  });
  if (!res.ok) return undefined;

  const json = await res.json();
  const children = json?.data?.children;
  if (!Array.isArray(children)) return undefined;

  const complaints: SocialComplaintItem[] = children
    .map((child: any) => {
      const d = child?.data;
      if (!d?.title || !d?.subreddit) return null;
      return {
        title: String(d.title),
        subreddit: String(d.subreddit),
        score: Number.isFinite(d.score) ? Number(d.score) : null,
        comments: Number.isFinite(d.num_comments) ? Number(d.num_comments) : null,
        url: d.permalink ? `https://reddit.com${String(d.permalink)}` : `https://reddit.com/${String(d.id ?? '')}`,
      };
    })
    .filter((x: SocialComplaintItem | null): x is SocialComplaintItem => Boolean(x));

  if (!complaints.length) return undefined;

  return {
    source: 'reddit',
    query: complaintQuery,
    captured_at: new Date().toISOString(),
    complaints,
  };
}

async function fetchPricePerformanceScaffold(): Promise<InfoGainFeeds['price_performance'] | undefined> {
  // Scaffold-first model: load snapshots from env when available.
  // Expected JSON array rows: [{ retailer, price, currency, inStock, url }]
  const raw = process.env.PRICE_SNAPSHOT_SEED_JSON;
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;

    const now = new Date().toISOString();
    const snapshots: RetailerPriceSnapshot[] = parsed
      .map((row: any) => ({
        retailer: String(row?.retailer ?? '').trim(),
        price: Number.isFinite(row?.price) ? Number(row.price) : null,
        currency: row?.currency ? String(row.currency) : null,
        inStock: typeof row?.inStock === 'boolean' ? row.inStock : null,
        url: row?.url ? String(row.url) : null,
        captured_at: now,
      }))
      .filter((r: RetailerPriceSnapshot) => Boolean(r.retailer));

    if (!snapshots.length) return undefined;

    return {
      source: 'retailer_snapshot',
      captured_at: now,
      snapshots,
      note: 'Scaffold feed populated from PRICE_SNAPSHOT_SEED_JSON until live retailer connectors are added.',
    };
  } catch {
    return undefined;
  }
}

export async function collectInfoGainFeeds(keyword: string): Promise<InfoGainFeeds> {
  const [scientific_alpha, social_sentiment, price_performance] = await Promise.all([
    withTimeout(fetchPubMedScientificAlpha(keyword), 4500, undefined),
    withTimeout(fetchRedditComplaintSnapshot(keyword), 4500, undefined),
    withTimeout(fetchPricePerformanceScaffold(), 1500, undefined),
  ]);

  return {
    ...(scientific_alpha ? { scientific_alpha } : {}),
    ...(social_sentiment ? { social_sentiment } : {}),
    ...(price_performance ? { price_performance } : {}),
  };
}

export function buildInfoFeedSections(feeds: InfoGainFeeds): PageBodySection[] {
  const out: PageBodySection[] = [];

  if (feeds.scientific_alpha?.items?.length) {
    out.push({
      id: 'scientific-alpha-feed',
      heading: 'Scientific Alpha: Latest PubMed signals',
      kind: 'list',
      content: {
        query: feeds.scientific_alpha.query,
        captured_at: feeds.scientific_alpha.captured_at,
        studies: feeds.scientific_alpha.items,
      },
    });
  }

  if (feeds.social_sentiment?.complaints?.length) {
    out.push({
      id: 'social-sentiment-feed',
      heading: 'Social sentiment snapshot: recent Reddit complaints',
      kind: 'list',
      content: {
        query: feeds.social_sentiment.query,
        captured_at: feeds.social_sentiment.captured_at,
        complaints: feeds.social_sentiment.complaints,
      },
    });
  }

  if (feeds.price_performance?.snapshots?.length) {
    const headers = ['Retailer', 'Price', 'Currency', 'In stock', 'URL'];
    const rows = feeds.price_performance.snapshots.map((s) => [
      s.retailer,
      s.price == null ? 'n/a' : String(s.price),
      s.currency ?? 'n/a',
      s.inStock == null ? 'unknown' : s.inStock ? 'yes' : 'no',
      s.url ?? 'n/a',
    ]);

    out.push({
      id: 'price-performance-feed',
      heading: 'Price performance scaffold: retailer snapshots',
      kind: 'table',
      content: {
        captured_at: feeds.price_performance.captured_at,
        note: feeds.price_performance.note,
        headers,
        rows,
      },
    });
  }

  return out;
}
