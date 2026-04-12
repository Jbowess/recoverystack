export type TemplateType =
  | 'guides'
  | 'alternatives'
  | 'protocols'
  | 'metrics'
  | 'costs'
  | 'compatibility'
  | 'trends'
  | 'pillars';

export type InternalLink = { slug: string; anchor: string; template?: TemplateType };

export type PageBodySection = {
  id: string;
  heading: string;
  kind: 'paragraphs' | 'faq' | 'steps' | 'list' | 'table';
  content: unknown;
};

export type InfoGainFeeds = {
  scientific_alpha?: {
    source: 'pubmed';
    query: string;
    captured_at: string;
    items: Array<{ title: string; journal: string | null; pubdate: string | null; url: string }>;
  };
  social_sentiment?: {
    source: 'reddit';
    query: string;
    captured_at: string;
    complaints: Array<{ title: string; subreddit: string; score: number | null; comments: number | null; url: string }>;
  };
  price_performance?: {
    source: 'retailer_snapshot';
    captured_at: string;
    snapshots: Array<{
      retailer: string;
      price: number | null;
      currency: string | null;
      inStock: boolean | null;
      url: string | null;
      captured_at: string;
    }>;
    note?: string;
  };
};

export type PageRecord = {
  id: string;
  slug: string;
  template: TemplateType;
  title: string;
  meta_description: string;
  h1: string;
  intro: string | null;
  body_json: {
    comparison_table?: { headers: string[]; rows: string[][] };
    verdict?: string[];
    sections?: PageBodySection[];
    faqs?: Array<{ q: string; a: string }>;
    info_gain_feeds?: InfoGainFeeds;
  } | null;
  pillar_id: string | null;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  internal_links: InternalLink[] | null;
  schema_org: unknown;
  status: 'draft' | 'approved' | 'published';
  published_at: string | null;
  updated_at: string;
};
