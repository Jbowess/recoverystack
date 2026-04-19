-- ============================================================
-- 0033_geo_and_competitor_brand.sql
-- GEO (Generative Engine Optimization) tracking
-- Competitor brand page generation pipeline
-- ============================================================

-- ── GEO optimizations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geo_optimizations (
  page_slug             text PRIMARY KEY,
  keyword               text NOT NULL,
  direct_answer         text NOT NULL,
  best_for              text NOT NULL,
  key_facts             jsonb NOT NULL DEFAULT '[]',
  has_speakable_schema  boolean NOT NULL DEFAULT false,
  has_item_list_schema  boolean NOT NULL DEFAULT false,
  ai_overview_detected  boolean NOT NULL DEFAULT false,
  citation_count        integer,           -- filled in by future monitoring
  optimized_at          timestamptz NOT NULL DEFAULT now(),
  last_checked_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_geo_optimizations_optimized_at ON geo_optimizations (optimized_at DESC);

-- ── Extend serp_features to track AI overview presence ────────────────────────
ALTER TABLE serp_features ADD COLUMN IF NOT EXISTS has_ai_overview boolean NOT NULL DEFAULT false;
ALTER TABLE serp_features ADD COLUMN IF NOT EXISTS ai_overview_sources jsonb;   -- URLs cited in the AI overview
ALTER TABLE serp_features ADD COLUMN IF NOT EXISTS our_page_cited boolean NOT NULL DEFAULT false;

-- ── Competitor brand pages pipeline ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitor_brand_pages (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug              text UNIQUE NOT NULL,
  competitor_domain text NOT NULL,
  page_type         text NOT NULL
                      CHECK (page_type IN ('alternatives', 'vs_comparison', 'review_vs', 'use_case')),
  primary_keyword   text NOT NULL,
  template          text NOT NULL,
  priority          integer NOT NULL DEFAULT 50,
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'generating', 'published', 'failed', 'skipped')),
  page_slug         text,                  -- set once page is generated
  generated_at      timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_brand_pages_domain  ON competitor_brand_pages (competitor_domain);
CREATE INDEX IF NOT EXISTS idx_competitor_brand_pages_status  ON competitor_brand_pages (status);
CREATE INDEX IF NOT EXISTS idx_competitor_brand_pages_type    ON competitor_brand_pages (page_type);
CREATE INDEX IF NOT EXISTS idx_competitor_brand_pages_priority ON competitor_brand_pages (priority DESC);

-- ── Link competitor brand page records back to pages when published ────────────
ALTER TABLE competitor_brand_pages
  ADD CONSTRAINT fk_competitor_brand_pages_page
  FOREIGN KEY (page_slug) REFERENCES pages(slug) ON DELETE SET NULL NOT VALID;

-- ── GEO performance monitoring (weekly snapshots) ─────────────────────────────
CREATE TABLE IF NOT EXISTS geo_performance_snapshots (
  snapshot_date            date PRIMARY KEY,
  pages_optimized          integer NOT NULL DEFAULT 0,
  pages_with_ai_citation   integer NOT NULL DEFAULT 0,
  ai_overview_keywords     integer NOT NULL DEFAULT 0,
  our_citation_rate_pct    numeric(5,2),
  recorded_at              timestamptz NOT NULL DEFAULT now()
);
