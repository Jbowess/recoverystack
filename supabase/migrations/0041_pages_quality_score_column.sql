-- Add quality_score column to pages table for direct quality-based filtering.
-- page-quality-scorer writes here after computing; geo-optimizer and CTR optimizer read it.
alter table pages add column if not exists quality_score integer;

create index if not exists idx_pages_quality_score on pages (quality_score desc) where status = 'published';
create index if not exists idx_pages_quality_score_position on pages (quality_score desc, status) where quality_score is not null;
