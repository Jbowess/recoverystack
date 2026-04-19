-- ============================================================
-- 0031_information_gathering_tables.sql
-- Enterprise information-gathering infrastructure tables.
-- Supports: competitor content analysis, product specs,
--           community Q&A, app reviews, keyword volume data,
--           SERP features, performance fingerprints,
--           cluster completeness, clinical trials.
-- ============================================================

-- ── Competitor page analyses ──────────────────────────────────────────────────
-- Stores full parsed content structure from competitor pages.
-- Written by: scripts/competitor-content-extractor.ts
-- Read by:    scripts/brief-generator.ts

CREATE TABLE IF NOT EXISTS competitor_page_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword         text NOT NULL,
  page_slug       text NOT NULL,          -- the RS page this analysis informs
  competitor_url  text NOT NULL,
  competitor_domain text NOT NULL,
  serp_position   int,
  word_count      int,
  reading_time_min int,

  -- Heading structure
  h1              text,
  h2_headings     text[]   DEFAULT '{}',
  h3_headings     text[]   DEFAULT '{}',
  heading_count   int      DEFAULT 0,

  -- Topic coverage
  required_entities   text[]   DEFAULT '{}',  -- entities that MUST appear per TF-IDF
  differentiating_entities text[] DEFAULT '{}', -- entities only in lower-rank pages
  tfidf_top_terms jsonb    DEFAULT '{}',      -- { term: score } top 30 terms

  -- Schema markup
  schema_types    text[]   DEFAULT '{}',
  has_faq_schema  boolean  DEFAULT false,
  has_how_to_schema boolean DEFAULT false,
  has_review_schema boolean DEFAULT false,

  -- Content signals
  has_comparison_table boolean DEFAULT false,
  has_numbered_list    boolean DEFAULT false,
  has_definition_box   boolean DEFAULT false,
  faq_count       int      DEFAULT 0,
  internal_links_count int DEFAULT 0,
  external_links_count int DEFAULT 0,
  image_count     int      DEFAULT 0,

  -- Raw data
  raw_headings    jsonb    DEFAULT '[]',
  raw_entities    jsonb    DEFAULT '[]',
  content_outline jsonb    DEFAULT '[]',    -- [{level, text, word_count}]
  meta_title      text,
  meta_description text,

  fetched_at      timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now(),

  UNIQUE (keyword, competitor_url)
);

CREATE INDEX IF NOT EXISTS idx_cpa_keyword       ON competitor_page_analyses(keyword);
CREATE INDEX IF NOT EXISTS idx_cpa_page_slug     ON competitor_page_analyses(page_slug);
CREATE INDEX IF NOT EXISTS idx_cpa_fetched_at    ON competitor_page_analyses(fetched_at DESC);

-- ── SERP features per keyword ─────────────────────────────────────────────────
-- Stores detected SERP features. Read by content-generator to choose format.
-- Written by: scripts/serp-feature-detector.ts (via gap-analyzer)

CREATE TABLE IF NOT EXISTS serp_features (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword         text NOT NULL UNIQUE,
  page_slug       text,

  -- Featured snippet
  has_featured_snippet     boolean DEFAULT false,
  featured_snippet_type    text,   -- paragraph | ordered_list | unordered_list | table
  featured_snippet_url     text,
  featured_snippet_domain  text,
  featured_snippet_text    text,

  -- SERP elements
  has_knowledge_panel  boolean DEFAULT false,
  has_video_carousel   boolean DEFAULT false,
  has_image_pack       boolean DEFAULT false,
  has_shopping_results boolean DEFAULT false,
  has_news_results     boolean DEFAULT false,
  has_local_pack       boolean DEFAULT false,
  has_site_links       boolean DEFAULT false,

  -- PAA tree (expanded)
  paa_questions   jsonb DEFAULT '[]',  -- [{question, snippet, link, sub_questions: []}]
  paa_count       int   DEFAULT 0,

  -- Organic metadata
  top_domain_types   text[]  DEFAULT '{}',  -- e.g. ['publisher','brand','aggregator']
  avg_serp_word_count int,
  result_count    text,                      -- Google's estimated result count

  -- Recommended format for our page
  recommended_format  text,  -- paragraph | numbered_list | table | faq | how_to

  queried_at      timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf_keyword    ON serp_features(keyword);
CREATE INDEX IF NOT EXISTS idx_sf_page_slug  ON serp_features(page_slug);

-- ── Authoritative keyword volume data ────────────────────────────────────────
-- DataForSEO / Ahrefs / SEMrush data. Separate from keyword_queue heuristics.
-- Written by: scripts/keyword-data-sync.ts

CREATE TABLE IF NOT EXISTS keyword_volume_data (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword         text NOT NULL,
  normalized_keyword text NOT NULL UNIQUE,
  data_source     text NOT NULL,  -- 'dataforseo' | 'ahrefs' | 'semrush' | 'gkp'

  search_volume_monthly int,
  search_volume_trend  text,      -- 'rising' | 'stable' | 'declining'
  cpc_usd         numeric(8,4),
  competition     numeric(4,3),   -- 0-1
  keyword_difficulty int,         -- 0-100
  serp_features_count int,
  parent_keyword  text,           -- canonical/head term this belongs to
  intent          text,           -- informational | commercial | navigational | transactional
  country         text DEFAULT 'AU',

  -- Monthly search volume history (last 12 months)
  monthly_searches jsonb DEFAULT '[]',  -- [{year, month, searches}]

  refreshed_at    timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kvd_keyword     ON keyword_volume_data(normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_kvd_volume      ON keyword_volume_data(search_volume_monthly DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_kvd_refreshed   ON keyword_volume_data(refreshed_at DESC);

-- ── Product / device spec database ───────────────────────────────────────────
-- Structured spec data for recovery wearables and devices.
-- Written by: scripts/product-spec-sync.ts  Read by: content-generator

CREATE TABLE IF NOT EXISTS product_specs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand           text NOT NULL,
  model           text NOT NULL,
  slug            text NOT NULL UNIQUE,
  product_type    text NOT NULL,  -- 'smart_ring' | 'fitness_band' | 'smartwatch' | 'sleep_device' | 'recovery_device'
  status          text DEFAULT 'active',  -- active | discontinued | upcoming

  -- Pricing
  price_usd       numeric(8,2),
  price_aud       numeric(8,2),
  subscription_usd numeric(8,2),  -- monthly subscription if applicable
  subscription_aud numeric(8,2),

  -- Hardware specs
  sensors         text[]  DEFAULT '{}',  -- ['optical_ppg','accelerometer','skin_temp','spo2']
  battery_days    int,
  water_resistance_atm int,
  weight_grams    numeric(5,1),
  form_factors    text[]  DEFAULT '{}',  -- ['ring','wrist','clip']

  -- Compatibility
  compatible_platforms text[] DEFAULT '{}',  -- ['ios','android','web']
  api_access      boolean DEFAULT false,
  third_party_integrations text[] DEFAULT '{}',

  -- Metrics tracked
  metrics_tracked text[]  DEFAULT '{}',  -- ['hrv','rhr','spo2','sleep_stages','readiness']

  -- Accuracy data
  accuracy_studies jsonb DEFAULT '[]',  -- [{title, sample_size, finding, url, year}]
  validated_metrics text[] DEFAULT '{}',  -- metrics with clinical validation

  -- Software
  app_rating_ios   numeric(3,2),
  app_rating_android numeric(3,2),
  app_review_count int,
  firmware_version text,
  last_firmware_date date,
  major_features  text[]  DEFAULT '{}',

  -- Competitive positioning
  key_competitors text[]  DEFAULT '{}',  -- other product slugs
  unique_selling_points text[] DEFAULT '{}',
  known_limitations text[]  DEFAULT '{}',

  -- Content
  official_url    text,
  press_kit_url   text,
  changelog_url   text,
  hero_image_url  text,
  release_date    date,
  discontinued_date date,

  metadata        jsonb   DEFAULT '{}',
  updated_at      timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ps_brand          ON product_specs(brand);
CREATE INDEX IF NOT EXISTS idx_ps_product_type   ON product_specs(product_type);
CREATE INDEX IF NOT EXISTS idx_ps_status         ON product_specs(status);

-- ── Community Q&A ─────────────────────────────────────────────────────────────
-- Long-tail questions and answers mined from forums, Reddit, and communities.
-- Written by: scripts/community-sentiment-miner.ts  Read by: brief-generator

CREATE TABLE IF NOT EXISTS community_qa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword         text NOT NULL,
  page_slug       text,
  source          text NOT NULL,  -- 'reddit' | 'garmin_community' | 'whoop_community' | 'youtube_comments'
  source_url      text,
  question        text NOT NULL,
  best_answer     text,
  upvotes         int,
  reply_count     int,
  sentiment       text,   -- 'positive' | 'negative' | 'neutral' | 'mixed'
  sentiment_score numeric(4,3),  -- -1 to 1
  user_language   text,          -- verbatim phrase the user used
  entity_mentions text[]  DEFAULT '{}',
  beat            text,
  relevance_score int     DEFAULT 0,
  captured_at     timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cqa_keyword    ON community_qa(keyword);
CREATE INDEX IF NOT EXISTS idx_cqa_page_slug  ON community_qa(page_slug);
CREATE INDEX IF NOT EXISTS idx_cqa_sentiment  ON community_qa(sentiment);
CREATE INDEX IF NOT EXISTS idx_cqa_source     ON community_qa(source);

-- ── App store reviews ─────────────────────────────────────────────────────────
-- iOS App Store + Google Play reviews for recovery apps/wearables.
-- Written by: scripts/app-review-miner.ts

CREATE TABLE IF NOT EXISTS app_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug    text NOT NULL,
  platform        text NOT NULL,  -- 'ios' | 'android'
  review_id       text,
  rating          int,   -- 1-5
  title           text,
  body            text,
  author          text,
  version         text,
  sentiment       text,
  sentiment_score numeric(4,3),
  key_themes      text[]  DEFAULT '{}',  -- extracted themes
  pain_points     text[]  DEFAULT '{}',
  positive_points text[]  DEFAULT '{}',
  use_case_mentioned text,
  captured_at     timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now(),

  UNIQUE (product_slug, platform, review_id)
);

CREATE INDEX IF NOT EXISTS idx_ar_product_slug ON app_reviews(product_slug);
CREATE INDEX IF NOT EXISTS idx_ar_rating       ON app_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_ar_sentiment    ON app_reviews(sentiment);

-- ── Performance fingerprints ──────────────────────────────────────────────────
-- Structural characteristics of top-performing published pages.
-- Written by: scripts/performance-fingerprint.ts  Read by: brief-generator

CREATE TABLE IF NOT EXISTS performance_fingerprints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template        text NOT NULL UNIQUE,  -- one fingerprint per template type

  -- Content structure
  avg_word_count      int,
  avg_section_count   int,
  avg_faq_count       int,
  avg_internal_links  int,
  avg_h2_count        int,
  avg_h3_count        int,

  -- Performance correlation
  top_performers      jsonb DEFAULT '[]',  -- [{slug, clicks, impressions, ctr, position}]
  top_performer_count int   DEFAULT 0,

  -- Structural patterns found in top performers
  common_section_types  text[]  DEFAULT '{}',
  common_opening_patterns text[] DEFAULT '{}',  -- how intros of top pages start
  stat_in_first_heading  boolean DEFAULT false,
  comparison_table_present boolean DEFAULT false,
  definition_box_present  boolean DEFAULT false,
  numbered_list_present   boolean DEFAULT false,

  -- Title patterns
  avg_title_length    int,
  title_starts_with_number boolean DEFAULT false,
  title_has_year      boolean DEFAULT false,
  title_has_brackets  boolean DEFAULT false,

  -- Correlations
  clicks_per_word_count  numeric(8,6),  -- efficiency ratio
  best_ctr_faq_count     int,           -- FAQ count that correlates with highest CTR
  best_ctr_word_range    text,          -- e.g. '800-1200'

  computed_at     timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

-- ── GSC impression orphans ────────────────────────────────────────────────────
-- Queries getting impressions in GSC with no matching page.
-- Written by: scripts/gsc-opportunity-miner.ts

CREATE TABLE IF NOT EXISTS gsc_impression_orphans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query           text NOT NULL UNIQUE,
  impressions     int  DEFAULT 0,
  clicks          int  DEFAULT 0,
  avg_position    numeric(5,1),
  opportunity_type text NOT NULL,  -- 'new_page' | 'title_fix' | 'content_gap' | 'position_push'
  suggested_template text,
  enqueued        boolean DEFAULT false,
  enqueued_at     timestamptz,
  first_seen_at   timestamptz DEFAULT now(),
  last_seen_at    timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gio_impressions ON gsc_impression_orphans(impressions DESC);
CREATE INDEX IF NOT EXISTS idx_gio_enqueued    ON gsc_impression_orphans(enqueued);
CREATE INDEX IF NOT EXISTS idx_gio_type        ON gsc_impression_orphans(opportunity_type);

-- ── Cluster completeness ──────────────────────────────────────────────────────
-- Tracks topical coverage holes per keyword cluster.
-- Written by: scripts/cluster-completeness-checker.ts

CREATE TABLE IF NOT EXISTS cluster_completeness (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id      uuid,
  cluster_name    text NOT NULL UNIQUE,
  topic           text NOT NULL,

  -- Coverage counts
  total_subtopics_detected int DEFAULT 0,
  covered_subtopics        int DEFAULT 0,
  completeness_pct         numeric(5,2) DEFAULT 0,

  -- Missing topics
  missing_subtopics   jsonb DEFAULT '[]',  -- [{topic, suggested_keyword, priority_score}]
  covered_slugs       text[] DEFAULT '{}',

  -- Semantic analysis
  semantic_holes      jsonb DEFAULT '[]',  -- [{gap_label, evidence_urls, priority}]
  competitor_coverage jsonb DEFAULT '{}',  -- {domain: [topics_they_cover_we_dont]}

  last_analyzed_at    timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_completeness ON cluster_completeness(completeness_pct ASC);
CREATE INDEX IF NOT EXISTS idx_cc_cluster_id   ON cluster_completeness(cluster_id);

-- ── Extend briefs table for richer content intelligence ───────────────────────
ALTER TABLE briefs
  ADD COLUMN IF NOT EXISTS required_entities        text[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tfidf_entities           jsonb     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS competitor_h2_patterns   text[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS competitor_schema_types  text[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommended_format       text,
  ADD COLUMN IF NOT EXISTS serp_has_featured_snippet boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS serp_featured_snippet_type text,
  ADD COLUMN IF NOT EXISTS performance_fingerprint  jsonb     DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS community_questions      text[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS positive_sentiment_phrases text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS keyword_volume           int,
  ADD COLUMN IF NOT EXISTS keyword_difficulty       int,
  ADD COLUMN IF NOT EXISTS search_intent            text;

-- ── Extend content_gaps for SERP features ────────────────────────────────────
ALTER TABLE content_gaps
  ADD COLUMN IF NOT EXISTS serp_features jsonb DEFAULT '{}';
