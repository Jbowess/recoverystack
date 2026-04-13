-- Per-page daily GSC metrics history — preserves historical data instead of overwriting
create table if not exists page_metrics_daily (
  id           uuid primary key default gen_random_uuid(),
  page_slug    text not null,
  date         date not null,
  position     numeric(6,2),
  clicks       integer,
  impressions  integer,
  ctr          numeric(6,4),         -- fraction (0.0–1.0)
  synced_at    timestamptz not null default now()
);

-- Unique constraint: one row per slug per day
create unique index if not exists page_metrics_daily_slug_date_idx on page_metrics_daily (page_slug, date);

-- Query patterns
create index if not exists page_metrics_daily_slug_idx on page_metrics_daily (page_slug);
create index if not exists page_metrics_daily_date_idx  on page_metrics_daily (date desc);
