-- ============================================================
-- 0032_tier1_tier2_tier3_tables.sql
-- Tables for all 15 gap-analysis systems:
--   Tier 1: rank_history, page_conversions/aggregates,
--            schema_validation_results, authors (extend),
--            system_flags, api_cost_log/snapshots
--   Tier 2: link_prospects, page_staleness_scores,
--            snippet_experiments, video_scripts, page_locales
--   Tier 3: content_diffs, ab_experiments, competitor_alerts,
--            cwv_fixes, cwv_health_snapshots
-- ============================================================

-- ── Rank history ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rank_history (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword               text NOT NULL,
  page_slug             text,
  domain                text NOT NULL,
  is_our_page           boolean NOT NULL DEFAULT false,
  position              integer NOT NULL,
  previous_position_7d  integer,
  previous_position_28d integer,
  delta_7d              integer,
  delta_28d             integer,
  featured_snippet_owned boolean NOT NULL DEFAULT false,
  has_paa               boolean NOT NULL DEFAULT false,
  serp_url              text,
  checked_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_history_keyword      ON rank_history (keyword);
CREATE INDEX IF NOT EXISTS idx_rank_history_page_slug    ON rank_history (page_slug);
CREATE INDEX IF NOT EXISTS idx_rank_history_checked_at   ON rank_history (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_our_page     ON rank_history (is_our_page, checked_at DESC);

-- ── Conversion attribution ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_conversions (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_charge_id    text UNIQUE,
  stripe_event_type   text,
  page_slug           text NOT NULL,
  revenue_usd         numeric(10,2) NOT NULL DEFAULT 0,
  attribution_model   text NOT NULL DEFAULT 'last_touch',
  attribution_weight  numeric(5,4) NOT NULL DEFAULT 1.0,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  customer_email      text,
  converted_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_conversions_slug         ON page_conversions (page_slug);
CREATE INDEX IF NOT EXISTS idx_page_conversions_converted_at ON page_conversions (converted_at DESC);

CREATE TABLE IF NOT EXISTS page_conversion_aggregates (
  page_slug             text PRIMARY KEY,
  total_revenue_usd     numeric(12,2) NOT NULL DEFAULT 0,
  purchase_count        integer NOT NULL DEFAULT 0,
  subscription_count    integer NOT NULL DEFAULT 0,
  avg_revenue_per_event numeric(10,2),
  first_conversion_at   timestamptz,
  last_conversion_at    timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Schema validation ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_validation_results (
  page_slug          text PRIMARY KEY,
  template           text,
  error_count        integer NOT NULL DEFAULT 0,
  warning_count      integer NOT NULL DEFAULT 0,
  issues             jsonb NOT NULL DEFAULT '[]',
  google_result      jsonb,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('passed', 'failed', 'warnings', 'pending')),
  auto_queued        boolean NOT NULL DEFAULT false,
  validated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schema_validation_status ON schema_validation_results (status);

-- ── System flags (circuit breaker, feature flags) ────────────────────────────
CREATE TABLE IF NOT EXISTS system_flags (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  metadata   jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the circuit breaker flag
INSERT INTO system_flags (key, value, metadata)
VALUES ('api_circuit_breaker_active', 'false', '{"reason": "initial seed"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── API cost tracking ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_cost_log (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  service            text NOT NULL,
  operation          text NOT NULL,
  units              numeric(12,4) NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  pipeline_run_id    uuid,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_cost_log_service     ON api_cost_log (service);
CREATE INDEX IF NOT EXISTS idx_api_cost_log_recorded_at ON api_cost_log (recorded_at DESC);

CREATE TABLE IF NOT EXISTS api_cost_snapshots (
  snapshot_date        date PRIMARY KEY,
  total_cost_usd       numeric(10,4) NOT NULL DEFAULT 0,
  monthly_cost_usd     numeric(10,2) NOT NULL DEFAULT 0,
  budget_daily_usd     numeric(10,2) NOT NULL DEFAULT 5,
  budget_monthly_usd   numeric(10,2) NOT NULL DEFAULT 50,
  daily_pct_used       numeric(6,1) NOT NULL DEFAULT 0,
  monthly_pct_used     numeric(6,1) NOT NULL DEFAULT 0,
  roi                  numeric(10,4),
  service_breakdown    jsonb NOT NULL DEFAULT '{}',
  circuit_breaker_active boolean NOT NULL DEFAULT false,
  over_limit_services  text[] NOT NULL DEFAULT '{}',
  recorded_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Link prospects ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS link_prospects (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_key      text UNIQUE NOT NULL,  -- md5(referring_domain + target_keyword)
  referring_domain  text NOT NULL,
  referring_url     text,
  target_page_slug  text,
  target_keyword    text,
  domain_rating     integer NOT NULL DEFAULT 0,
  competitor_count  integer NOT NULL DEFAULT 0,
  priority_score    integer NOT NULL DEFAULT 0,
  link_context      text CHECK (link_context IN ('editorial', 'review', 'research', 'commercial', 'unknown')),
  anchor_text       text,
  status            text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'contacted', 'acquired', 'rejected', 'monitoring')),
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_prospects_status   ON link_prospects (status);
CREATE INDEX IF NOT EXISTS idx_link_prospects_priority ON link_prospects (priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_link_prospects_domain   ON link_prospects (referring_domain);

-- ── Content staleness scores ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_staleness_scores (
  page_slug          text PRIMARY KEY,
  staleness_score    integer NOT NULL DEFAULT 0,
  staleness_reasons  jsonb NOT NULL DEFAULT '[]',
  refresh_priority   text NOT NULL DEFAULT 'fresh'
                       CHECK (refresh_priority IN ('critical', 'high', 'medium', 'low', 'fresh')),
  auto_queued        boolean NOT NULL DEFAULT false,
  scored_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staleness_priority ON page_staleness_scores (refresh_priority, staleness_score DESC);

-- ── Featured snippet experiments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snippet_experiments (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword          text UNIQUE NOT NULL,
  page_slug        text NOT NULL,
  snippet_type     text NOT NULL CHECK (snippet_type IN ('paragraph', 'ordered_list', 'unordered_list', 'table', 'unknown')),
  strategy         jsonb NOT NULL DEFAULT '{}',
  instructions     text,
  displacement_detected boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'applied', 'won', 'lost', 'monitoring')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snippet_experiments_status    ON snippet_experiments (status);
CREATE INDEX IF NOT EXISTS idx_snippet_experiments_page_slug ON snippet_experiments (page_slug);

-- ── Video scripts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_scripts (
  id                          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_slug                   text UNIQUE NOT NULL,
  keyword                     text NOT NULL,
  hook                        text,
  chapters                    jsonb NOT NULL DEFAULT '[]',
  cta                         text,
  youtube_description         text,
  youtube_tags                text[] NOT NULL DEFAULT '{}',
  estimated_duration_minutes  integer,
  status                      text NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  youtube_video_id            text,
  generated_at                timestamptz NOT NULL DEFAULT now(),
  published_at                timestamptz
);

CREATE INDEX IF NOT EXISTS idx_video_scripts_status ON video_scripts (status);

-- ── Locale variants ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_locales (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_slug        text NOT NULL,
  locale           text NOT NULL,
  locale_name      text NOT NULL,
  template         text,
  title            text,
  meta_description text,
  primary_keyword  text,
  body_json        jsonb,
  hreflang         jsonb NOT NULL DEFAULT '{}',
  currency_code    text,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'archived')),
  generated_at     timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (page_slug, locale)
);

CREATE INDEX IF NOT EXISTS idx_page_locales_slug   ON page_locales (page_slug);
CREATE INDEX IF NOT EXISTS idx_page_locales_locale ON page_locales (locale);
CREATE INDEX IF NOT EXISTS idx_page_locales_status ON page_locales (status);

-- ── Content diffs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_diffs (
  page_slug        text PRIMARY KEY,
  similarity_score numeric(5,4),
  word_count_old   integer,
  word_count_new   integer,
  faq_count_old    integer,
  faq_count_new    integer,
  action           text NOT NULL DEFAULT 'approve'
                     CHECK (action IN ('approve', 'flag_for_review', 'block')),
  failure_reasons  text[] NOT NULL DEFAULT '{}',
  checked_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_diffs_action ON content_diffs (action);

-- ── A/B test experiments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ab_experiments (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_slug             text NOT NULL,
  experiment_type       text NOT NULL,  -- e.g. 'intro_variant', 'title_variant'
  control_content       text,
  test_content          text,
  control_impressions   integer NOT NULL DEFAULT 0,
  control_clicks        integer NOT NULL DEFAULT 0,
  test_impressions      integer NOT NULL DEFAULT 0,
  test_clicks           integer NOT NULL DEFAULT 0,
  chi_square_stat       numeric(10,6),
  p_value               numeric(10,8),
  winner                text CHECK (winner IN ('control', 'test', NULL)),
  status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'significant', 'insufficient_data', 'promoted', 'archived')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  evaluated_at          timestamptz,
  UNIQUE (page_slug, experiment_type)
);

CREATE INDEX IF NOT EXISTS idx_ab_experiments_status    ON ab_experiments (status);
CREATE INDEX IF NOT EXISTS idx_ab_experiments_page_slug ON ab_experiments (page_slug);

-- ── Competitor alerts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitor_alerts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_key       text UNIQUE NOT NULL,  -- md5(alert_type + keyword + competitor_domain)
  alert_type      text NOT NULL CHECK (alert_type IN ('new_competitor_page', 'position_gain', 'content_surge')),
  keyword         text NOT NULL,
  competitor_domain text NOT NULL,
  competitor_url  text,
  our_page_slug   text,
  severity        text NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  details         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'reviewed', 'actioned', 'dismissed')),
  refresh_queued  boolean NOT NULL DEFAULT false,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_alerts_severity ON competitor_alerts (severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_alerts_status   ON competitor_alerts (status);
CREATE INDEX IF NOT EXISTS idx_competitor_alerts_keyword  ON competitor_alerts (keyword);

-- ── CWV fixes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cwv_fixes (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  page_slug       text NOT NULL,
  template        text,
  metric          text NOT NULL CHECK (metric IN ('lcp', 'cls', 'inp', 'fid', 'ttfb')),
  measured_value  numeric(12,4) NOT NULL,
  threshold       numeric(12,4) NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('critical', 'poor', 'needs_improvement')),
  fix_type        text NOT NULL,
  recommendation  text NOT NULL,
  applied         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_slug, metric)
);

CREATE INDEX IF NOT EXISTS idx_cwv_fixes_severity  ON cwv_fixes (severity);
CREATE INDEX IF NOT EXISTS idx_cwv_fixes_applied   ON cwv_fixes (applied);
CREATE INDEX IF NOT EXISTS idx_cwv_fixes_page_slug ON cwv_fixes (page_slug);

-- ── CWV health snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cwv_health_snapshots (
  snapshot_date    date PRIMARY KEY,
  pages_measured   integer NOT NULL DEFAULT 0,
  pages_with_issues integer NOT NULL DEFAULT 0,
  median_lcp_ms    numeric(10,2),
  median_cls       numeric(6,4),
  median_inp_ms    numeric(10,2),
  pct_good_lcp     integer,
  pct_good_cls     integer,
  recorded_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Authors table (ensure it exists with full schema) ─────────────────────────
CREATE TABLE IF NOT EXISTS authors (
  slug                text PRIMARY KEY,
  name                text NOT NULL,
  title               text,
  bio                 text,
  credentials         text[] NOT NULL DEFAULT '{}',
  expertise_templates text[] NOT NULL DEFAULT '{}',
  expertise_beats     text[] NOT NULL DEFAULT '{}',
  persona             text,
  author_type         text NOT NULL DEFAULT 'expert'
                        CHECK (author_type IN ('expert', 'editorial', 'ai_assisted')),
  linkedin_url        text,
  twitter_url         text,
  institution_url     text,
  avatar_url          text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Add reviewer_slug column to authors if not already present (for peer review pairs)
ALTER TABLE authors ADD COLUMN IF NOT EXISTS reviewer_slug text REFERENCES authors(slug);

-- ── Extend existing tables ────────────────────────────────────────────────────

-- pages: add conversion and ranking metadata columns
ALTER TABLE pages ADD COLUMN IF NOT EXISTS featured_snippet_owned boolean NOT NULL DEFAULT false;

-- page_locales: add needs_revalidation
ALTER TABLE page_locales ADD COLUMN IF NOT EXISTS needs_revalidation boolean NOT NULL DEFAULT false;

-- briefs: snippet strategy column (added by snippet-optimizer)
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS snippet_strategy jsonb;

-- ── Indexes for common join patterns ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_authors_is_active        ON authors (is_active);
CREATE INDEX IF NOT EXISTS idx_authors_expertise_beats  ON authors USING gin (expertise_beats);
CREATE INDEX IF NOT EXISTS idx_authors_expertise_tmpl   ON authors USING gin (expertise_templates);
