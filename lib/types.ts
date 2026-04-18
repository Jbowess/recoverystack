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
  | 'checklists'
  | 'news';

export type InternalLink = { slug: string; anchor: string; template?: TemplateType };

export type PageBodySection = {
  id: string;
  heading: string;
  kind: 'paragraphs' | 'faq' | 'steps' | 'list' | 'table' | 'definition_box';
  content: unknown;
};

export type NewsSourceEvent = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source_domain: string | null;
  source_type?: string | null;
  published_at: string | null;
  event_type: string;
  relevance_score: number;
  authority_score: number;
  freshness_score: number;
  significance_score?: number | null;
  beat: string;
  extraction?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type TopicEntity = {
  id: string;
  slug: string;
  canonical_name: string;
  entity_type: string;
  beat: string;
  authority_score: number;
  confidence_score: number;
  metadata?: Record<string, unknown> | null;
};

export type Storyline = {
  id: string;
  slug: string;
  title: string;
  beat: string;
  storyline_type: string;
  status: string;
  authority_score: number;
  freshness_score: number;
  update_count: number;
  summary?: string | null;
  latest_event_at?: string | null;
  canonical_entity_id?: string | null;
  metadata?: Record<string, unknown> | null;
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
    newsroom_context?: {
      story_summary?: string;
      what_changed?: string[];
      known_facts?: string[];
      what_we_do_not_know_yet?: string[];
      key_claims?: string[];
      source_categories?: string[];
      timeline?: Array<{ label: string; date?: string | null }>;
      source_events?: NewsSourceEvent[];
      storyline?: Storyline | null;
      entities?: TopicEntity[];
    };
  } | null;
  pillar_id: string | null;
  primary_keyword: string | null;
  secondary_keywords: string[] | null;
  internal_links: InternalLink[] | null;
  schema_org: unknown;
  metadata: Record<string, unknown> | null;
  content_type?: string | null;
  news_format?: string | null;
  beat?: string | null;
  freshness_tier?: string | null;
  story_status?: string | null;
  source_event_id?: string | null;
  storyline_id?: string | null;
  last_verified_at?: string | null;
  status: 'draft' | 'approved' | 'published' | 'archived';
  last_generated_at?: string | null;
  needs_revalidation?: boolean;
  last_deployed_at?: string | null;
  published_at: string | null;
  updated_at: string;
};
