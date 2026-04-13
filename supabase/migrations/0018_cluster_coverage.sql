-- Topical authority map — tracks which templates exist per cluster
-- Populated nightly by scripts/topical-map.ts
create table if not exists cluster_coverage (
  id                   uuid primary key default gen_random_uuid(),
  cluster_name         text not null unique,
  guides_count         int  not null default 0,
  alternatives_count   int  not null default 0,
  protocols_count      int  not null default 0,
  metrics_count        int  not null default 0,
  costs_count          int  not null default 0,
  compatibility_count  int  not null default 0,
  trends_count         int  not null default 0,
  pillars_count        int  not null default 0,
  total_published      int  not null default 0,
  completeness_pct     numeric(5,2) not null default 0,
  missing_templates    text[] not null default '{}',
  updated_at           timestamptz not null default now()
);

create index if not exists cluster_coverage_completeness_idx on cluster_coverage (completeness_pct asc);
