export type TemplateType =
  | 'guides'
  | 'alternatives'
  | 'protocols'
  | 'metrics'
  | 'costs'
  | 'compatibility'
  | 'trends'
  | 'pillars'
  | 'reviews'
  | 'checklists';

export type InternalLink = { slug: string; anchor: string; template?: TemplateType };

export type PageBodySection = {
  id: string;
  heading: string;
  kind: 'paragraphs' | 'faq' | 'steps' | 'list' | 'table' | 'definition_box';
  content: unknown;
};

export type PageReference = {
  title: string;
  url: string;
  source?: string | null;
  year?: string | null;
};

export type ReviewMethodology = {
  summary?: string;
  tested?: string[];
  scoring?: string[];
  use_cases?: string[];
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
    key_takeaways?: string[];
    references?: PageReference[];
    review_methodology?: ReviewMethodology;
    info_gain_feeds?: InfoGainFeeds;
  } | null;
  pillar_id: string | null;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  internal_links: InternalLink[] | null;
  schema_org: unknown;
  metadata: Record<string, unknown> | null;
  status: 'draft' | 'approved' | 'published' | 'archived';
  last_generated_at?: string | null;
  needs_revalidation?: boolean;
  last_deployed_at?: string | null;
  published_at: string | null;
  updated_at: string;
};
