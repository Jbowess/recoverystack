-- ============================================================
-- 0033_information_gathering_extensions.sql
-- Extends 0030 with clinical trials, app review aggregates,
-- corrected performance_fingerprints + cluster_completeness
-- schemas, and additional briefs enrichment columns.
-- ============================================================

-- ── Clinical Trials ───────────────────────────────────────────────────────────
-- Monitoring study registrations relevant to recovery + wearables.
-- Written by: scripts/clinical-trials-monitor.ts

CREATE TABLE IF NOT EXISTS clinical_trials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nct_id            text NOT NULL UNIQUE,
  title             text NOT NULL,
  official_title    text,
  status            text NOT NULL,   -- RECRUITING | ACTIVE_NOT_RECRUITING | COMPLETED | ...
  phase             text,            -- PHASE2 | PHASE3 | PHASE4 | N/A
  study_type        text NOT NULL,   -- INTERVENTIONAL | OBSERVATIONAL
  sponsor_name      text NOT NULL,
  sponsor_class     text,            -- NIH | FED | INDIV | INDUSTRY | NETWORK | OTHER
  brief_summary     text,
  conditions        text[]  DEFAULT '{}',
  keywords          text[]  DEFAULT '{}',
  primary_outcomes  text[]  DEFAULT '{}',
  start_date        text,
  completion_date   text,
  enrollment_count  int,
  sex_eligibility   text,
  minimum_age       text,
  maximum_age       text,
  lead_official     text,
  lead_institution  text,
  significance_score int    DEFAULT 0,
  beat              text,
  matched_query     text,
  entity_ids        text[]  DEFAULT '{}',
  page_slugs        text[]  DEFAULT '{}',
  fetched_at        timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ct_nct_id       ON clinical_trials(nct_id);
CREATE INDEX IF NOT EXISTS idx_ct_status       ON clinical_trials(status);
CREATE INDEX IF NOT EXISTS idx_ct_significance ON clinical_trials(significance_score DESC);
CREATE INDEX IF NOT EXISTS idx_ct_beat         ON clinical_trials(beat);
CREATE INDEX IF NOT EXISTS idx_ct_fetched_at   ON clinical_trials(fetched_at DESC);

-- ── App Reviews (with correct dedup key) ─────────────────────────────────────
-- Overrides 0030 definition with review_key dedup instead of
-- (product_slug, platform, review_id) to match app-review-miner.ts

DROP TABLE IF EXISTS app_reviews;

CREATE TABLE IF NOT EXISTS app_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_key      text NOT NULL UNIQUE,
  app_slug        text NOT NULL,
  app_name        text NOT NULL,
  platform        text NOT NULL,    -- 'ios' | 'android'
  rating          int,              -- 1-5
  title           text,
  body            text,
  author          text,
  review_date     timestamptz,
  version         text,
  helpful_count   int  DEFAULT 0,
  sentiment       text,             -- 'positive' | 'negative' | 'neutral' | 'mixed'
  pain_points     text[]  DEFAULT '{}',
  praised_features text[] DEFAULT '{}',
  competitor_mentions text[] DEFAULT '{}',
  themes          text[]  DEFAULT '{}',
  beat            text,
  fetched_at      timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_app_slug    ON app_reviews(app_slug);
CREATE INDEX IF NOT EXISTS idx_ar_platform    ON app_reviews(platform);
CREATE INDEX IF NOT EXISTS idx_ar_rating      ON app_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_ar_sentiment   ON app_reviews(sentiment);
CREATE INDEX IF NOT EXISTS idx_ar_fetched_at  ON app_reviews(fetched_at DESC);

-- ── App Review Aggregates ─────────────────────────────────────────────────────
-- Rolled-up sentiment per app. Written by: scripts/app-review-miner.ts

CREATE TABLE IF NOT EXISTS app_review_aggregates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_slug              text NOT NULL UNIQUE,
  review_count          int  DEFAULT 0,
  avg_rating            numeric(3,1),
  positive_pct          int,
  negative_pct          int,
  top_pain_points       text[]  DEFAULT '{}',
  top_praised_features  text[]  DEFAULT '{}',
  top_themes            text[]  DEFAULT '{}',
  competitor_mentions   text[]  DEFAULT '{}',
  aggregated_at         timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ara_app_slug     ON app_review_aggregates(app_slug);
CREATE INDEX IF NOT EXISTS idx_ara_avg_rating   ON app_review_aggregates(avg_rating DESC NULLS LAST);

-- ── Performance Fingerprints (cluster+template composite key) ─────────────────
-- Replaces 0030 which used template UNIQUE; script uses cluster_slug+template.

DROP TABLE IF EXISTS performance_fingerprints;

CREATE TABLE IF NOT EXISTS performance_fingerprints (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_slug              text NOT NULL,
  template                  text NOT NULL,
  sample_size               int  DEFAULT 0,

  -- Word count distribution
  median_word_count         int,
  p25_word_count            int,
  p75_word_count            int,
  recommended_word_count_min int,
  recommended_word_count_max int,

  -- Structure
  median_h2_count           int,
  faq_usage_rate            numeric(4,3),
  table_usage_rate          numeric(4,3),
  median_image_count        int,
  median_internal_links     int,
  common_schema_types       text[]  DEFAULT '{}',
  h2_patterns               jsonb   DEFAULT '{}',  -- {question: 40, how_to: 25, ...}

  -- Performance benchmarks
  avg_quality_score         int,
  avg_position              numeric(5,1),

  computed_at               timestamptz DEFAULT now(),
  created_at                timestamptz DEFAULT now(),

  UNIQUE (cluster_slug, template)
);

CREATE INDEX IF NOT EXISTS idx_pf_cluster_slug ON performance_fingerprints(cluster_slug);
CREATE INDEX IF NOT EXISTS idx_pf_computed_at  ON performance_fingerprints(computed_at DESC);

-- ── Cluster Completeness (cluster_slug key) ───────────────────────────────────
-- Replaces 0030 definition; script uses cluster_slug as conflict key.

DROP TABLE IF EXISTS cluster_completeness;

CREATE TABLE IF NOT EXISTS cluster_completeness (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_slug              text NOT NULL UNIQUE,
  cluster_label             text NOT NULL,
  completeness_score        int  DEFAULT 0,   -- 0-100

  -- Page counts
  pages_published           int  DEFAULT 0,
  pages_draft               int  DEFAULT 0,
  pages_queued              int  DEFAULT 0,

  -- Coverage
  has_pillar                boolean DEFAULT false,
  covered_templates         text[]  DEFAULT '{}',
  missing_templates         text[]  DEFAULT '{}',

  -- Gap counts
  paa_gap_count             int  DEFAULT 0,
  competitor_entity_gap_count int DEFAULT 0,
  keyword_variation_gap_count int DEFAULT 0,

  -- Full gap list
  gaps                      jsonb   DEFAULT '[]',  -- [{gap_type, description, suggested_keyword, priority_score}]
  enqueued_keywords         text[]  DEFAULT '{}',

  checked_at                timestamptz DEFAULT now(),
  created_at                timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_cluster_slug    ON cluster_completeness(cluster_slug);
CREATE INDEX IF NOT EXISTS idx_cc_completeness    ON cluster_completeness(completeness_score ASC);
CREATE INDEX IF NOT EXISTS idx_cc_checked_at      ON cluster_completeness(checked_at DESC);

-- ── Additional briefs enrichment columns ──────────────────────────────────────
ALTER TABLE briefs
  ADD COLUMN IF NOT EXISTS serp_feature_context     jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS structural_guidance       jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS product_specs            jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS upcoming_research        jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS product_sentiment        jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommended_schema_types text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS community_questions      jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS positive_sentiment_phrases text[] DEFAULT '{}';

-- Also add avg_word_count alias on competitor_page_analyses for brief-generator join
ALTER TABLE competitor_page_analyses
  ADD COLUMN IF NOT EXISTS avg_word_count int,
  ADD COLUMN IF NOT EXISTS position       int;

-- Update avg_word_count from word_count on existing rows
UPDATE competitor_page_analyses
  SET avg_word_count = word_count
  WHERE avg_word_count IS NULL AND word_count IS NOT NULL;

-- Rename serp_position → position alias (add position column mirroring serp_position)
UPDATE competitor_page_analyses
  SET position = serp_position
  WHERE position IS NULL AND serp_position IS NOT NULL;

-- ── product_specs slug-based schema ──────────────────────────────────────────
-- 0030 used different column names. Add missing columns to match product-spec-sync.ts

ALTER TABLE product_specs
  ADD COLUMN IF NOT EXISTS category                  text,
  ADD COLUMN IF NOT EXISTS price_usd                 numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_aud                 numeric(10,2),
  ADD COLUMN IF NOT EXISTS release_date              text,
  ADD COLUMN IF NOT EXISTS discontinued              boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS battery_life_hours        int,
  ADD COLUMN IF NOT EXISTS battery_life_note         text,
  ADD COLUMN IF NOT EXISTS weight_grams              numeric(7,1),
  ADD COLUMN IF NOT EXISTS water_resistance_atm      int,
  ADD COLUMN IF NOT EXISTS display_type              text,
  ADD COLUMN IF NOT EXISTS display_resolution        text,
  ADD COLUMN IF NOT EXISTS gps_type                  text,
  ADD COLUMN IF NOT EXISTS health_metrics            text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS connectivity              text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS platforms                 text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS subscription_required     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_price_usd_month numeric(8,2),
  ADD COLUMN IF NOT EXISTS form_factor               text,
  ADD COLUMN IF NOT EXISTS colors                    text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dimensions_mm             text,
  ADD COLUMN IF NOT EXISTS affiliate_url             text,
  ADD COLUMN IF NOT EXISTS page_slug                 text,
  ADD COLUMN IF NOT EXISTS raw_specs                 jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS synced_at                 timestamptz DEFAULT now();
