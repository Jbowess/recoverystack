-- ============================================================
-- 0038_use_case_and_buying_guide_pages.sql
-- Tracking tables for programmatic page generation:
--   use_case_pages  — category × modifier sub-pages
--   buying_guide_pages — buying guide intent pages
-- ============================================================

-- ── Use-case sub-pages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS use_case_pages (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          text UNIQUE NOT NULL,
  category_id   text NOT NULL,    -- matches CategoryDef.id
  modifier_id   text NOT NULL,    -- matches Modifier.id
  primary_keyword text NOT NULL,
  template      text NOT NULL,
  priority      integer NOT NULL DEFAULT 50,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'generating', 'published', 'failed', 'skipped')),
  page_slug     text,             -- set once page is generated
  generated_at  timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_use_case_pages_category ON use_case_pages (category_id);
CREATE INDEX IF NOT EXISTS idx_use_case_pages_status   ON use_case_pages (status);
CREATE INDEX IF NOT EXISTS idx_use_case_pages_priority ON use_case_pages (priority DESC);

-- ── Buying guide pages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buying_guide_pages (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug          text UNIQUE NOT NULL,
  category_id   text NOT NULL,    -- matches GuideCategoryDef.id
  pattern_id    text NOT NULL,    -- matches GuidePattern.id
  primary_keyword text NOT NULL,
  priority      integer NOT NULL DEFAULT 50,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'generating', 'published', 'failed', 'skipped')),
  page_slug     text,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buying_guide_pages_category ON buying_guide_pages (category_id);
CREATE INDEX IF NOT EXISTS idx_buying_guide_pages_pattern  ON buying_guide_pages (pattern_id);
CREATE INDEX IF NOT EXISTS idx_buying_guide_pages_status   ON buying_guide_pages (status);
CREATE INDEX IF NOT EXISTS idx_buying_guide_pages_priority ON buying_guide_pages (priority DESC);

-- ── Convenience view: all programmatic page types in one place ────────────────
CREATE OR REPLACE VIEW programmatic_page_pipeline AS
  SELECT slug, 'use_case'        AS page_type, category_id AS category, modifier_id  AS variant, primary_keyword, template, priority, status, generated_at FROM use_case_pages
  UNION ALL
  SELECT slug, 'buying_guide'    AS page_type, category_id AS category, pattern_id   AS variant, primary_keyword, 'guides'  AS template, priority, status, generated_at FROM buying_guide_pages
  UNION ALL
  SELECT slug, page_type::text   AS page_type, competitor_domain AS category, page_type::text AS variant, primary_keyword, template, priority, status, generated_at FROM competitor_brand_pages;
