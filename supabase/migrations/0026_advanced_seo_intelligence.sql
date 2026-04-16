create table if not exists page_query_targets (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  query text not null,
  normalized_query text not null,
  intent text not null default 'informational',
  source text not null default 'planner',
  priority integer not null default 50,
  search_volume integer,
  keyword_difficulty integer,
  current_ctr numeric(6,4),
  current_position numeric(6,2),
  is_primary boolean not null default false,
  cluster_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, normalized_query)
);

create index if not exists idx_page_query_targets_page on page_query_targets (page_id, priority desc);
create index if not exists idx_page_query_targets_norm on page_query_targets (normalized_query);
create index if not exists idx_page_query_targets_intent on page_query_targets (intent, priority desc);

create table if not exists page_source_references (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  title text not null,
  url text not null,
  source_domain text,
  source_type text not null default 'editorial_reference',
  authority_score integer not null default 50,
  evidence_level text not null default 'supporting',
  published_at text,
  cited_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (page_id, url)
);

create index if not exists idx_page_source_references_page on page_source_references (page_id, authority_score desc);
create index if not exists idx_page_source_references_domain on page_source_references (source_domain);

create table if not exists page_visual_assets (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  asset_kind text not null default 'supporting',
  image_url text,
  alt_text text,
  width integer,
  height integer,
  purpose text not null default 'supplemental',
  status text not null default 'planned',
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_page_visual_assets_page on page_visual_assets (page_id, sort_order asc);
create index if not exists idx_page_visual_assets_status on page_visual_assets (status, created_at desc);
create unique index if not exists page_visual_assets_page_kind_sort_uidx on page_visual_assets (page_id, asset_kind, sort_order);

create table if not exists page_title_experiments (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  channel text not null default 'organic_search',
  variant text not null,
  title text not null,
  score integer,
  status text not null default 'suggested',
  reason text,
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  selected_at timestamptz,
  unique (page_id, channel, variant)
);

create index if not exists idx_page_title_experiments_page on page_title_experiments (page_id, channel, generated_at desc);

create table if not exists page_quality_scores (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  score_type text not null default 'seo_quality',
  total_score integer not null,
  breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_quality_scores_page on page_quality_scores (page_id, created_at desc);
create index if not exists idx_page_quality_scores_total on page_quality_scores (total_score asc, created_at desc);

create table if not exists page_refresh_signals (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  signal_type text not null,
  severity integer not null default 50,
  status text not null default 'open',
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (page_id, signal_type, status)
);

create index if not exists idx_page_refresh_signals_page on page_refresh_signals (page_id, status, severity desc);
create index if not exists idx_page_refresh_signals_signal on page_refresh_signals (signal_type, status);
