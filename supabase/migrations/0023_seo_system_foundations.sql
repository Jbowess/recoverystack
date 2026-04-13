-- SEO system foundations:
-- 1. Trend provenance/history via trend_observations
-- 2. First-class keyword_clusters table for cluster-aware queueing
-- 3. Broader keyword_queue support for all template/source types used by scripts

create extension if not exists pg_trgm;

create table if not exists keyword_clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  topic text not null,
  description text,
  business_value integer not null default 50,
  source_of_truth text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists keyword_clusters_business_value_idx
  on keyword_clusters (business_value desc, updated_at desc);

create or replace function set_keyword_clusters_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_keyword_clusters_updated_at on keyword_clusters;
create trigger trg_keyword_clusters_updated_at
before update on keyword_clusters
for each row execute function set_keyword_clusters_updated_at();

alter table keyword_queue
  add column if not exists normalized_keyword text,
  add column if not exists cluster_id uuid references keyword_clusters(id) on delete set null,
  add column if not exists processed_at timestamptz,
  add column if not exists source_detail text;

update keyword_queue
set normalized_keyword = lower(trim(primary_keyword))
where normalized_keyword is null;

create index if not exists keyword_queue_normalized_keyword_idx
  on keyword_queue (normalized_keyword);

create index if not exists keyword_queue_cluster_id_idx
  on keyword_queue (cluster_id, status, priority desc);

alter table keyword_queue
  drop constraint if exists keyword_queue_template_id_check;

alter table keyword_queue
  add constraint keyword_queue_template_id_check
  check (
    template_id in (
      'comparison',
      'guide',
      'protocol',
      'guides',
      'alternatives',
      'protocols',
      'metrics',
      'costs',
      'compatibility',
      'trends',
      'pillars'
    )
  );

alter table keyword_queue
  drop constraint if exists keyword_queue_source_check;

alter table keyword_queue
  add constraint keyword_queue_source_check
  check (
    source in (
      'evergreen',
      'trend',
      'paa',
      'related_search',
      'modifier_expansion',
      'topical_gap'
    )
  );

alter table trends
  add column if not exists normalized_term text,
  add column if not exists trend_score integer,
  add column if not exists search_volume integer,
  add column if not exists priority integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists source_count integer not null default 1,
  add column if not exists sighting_count integer not null default 1;

update trends
set
  normalized_term = coalesce(normalized_term, lower(trim(term))),
  trend_score = coalesce(trend_score, least(100, greatest(1, round(coalesce(score, 0) * 100)::int))),
  priority = coalesce(priority, least(100, greatest(1, round(coalesce(score, 0) * 100)::int))),
  first_seen_at = coalesce(first_seen_at, created_at, now()),
  last_seen_at = coalesce(last_seen_at, created_at, now())
where normalized_term is null
   or trend_score is null
   or priority is null
   or first_seen_at is null
   or last_seen_at is null;

create unique index if not exists trends_normalized_term_uidx
  on trends (normalized_term);

create index if not exists trends_status_score_idx
  on trends (status, trend_score desc nulls last, last_seen_at desc);

create table if not exists trend_observations (
  id uuid primary key default gen_random_uuid(),
  trend_id uuid references trends(id) on delete cascade,
  normalized_term text not null,
  raw_term text not null,
  source text not null,
  source_item_id text,
  observed_at timestamptz not null default now(),
  score integer,
  approx_traffic text,
  geo text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists trend_observations_term_time_idx
  on trend_observations (normalized_term, observed_at desc);

create index if not exists trend_observations_source_time_idx
  on trend_observations (source, observed_at desc);
