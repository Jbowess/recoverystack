alter table pages add column if not exists commercial_readiness_score integer;
alter table pages add column if not exists commercial_readiness_status text;
alter table pages add column if not exists commercial_last_audited_at timestamptz;

create index if not exists idx_pages_commercial_readiness
  on pages (status, commercial_readiness_score desc nulls last, updated_at desc);

create table if not exists crawler_activity_logs (
  id uuid primary key default gen_random_uuid(),
  bot_family text not null,
  user_agent text not null,
  request_path text not null,
  request_method text not null default 'GET',
  referrer text,
  ip_hash text,
  source_host text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_crawler_activity_logs_family
  on crawler_activity_logs (bot_family, created_at desc);

create index if not exists idx_crawler_activity_logs_path
  on crawler_activity_logs (request_path, created_at desc);

create table if not exists llm_prompt_corpus (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null unique,
  prompt_text text not null,
  normalized_prompt text not null,
  channel text not null default 'chatgpt',
  intent text not null default 'commercial',
  page_id uuid references pages(id) on delete set null,
  page_slug text,
  priority integer not null default 50,
  status text not null default 'active' check (status in ('active', 'testing', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_llm_prompt_corpus_channel
  on llm_prompt_corpus (channel, status, priority desc, updated_at desc);

create index if not exists idx_llm_prompt_corpus_slug
  on llm_prompt_corpus (page_slug, channel, priority desc);

create table if not exists llm_recommendation_share_snapshots (
  snapshot_date date not null default current_date,
  channel text not null,
  entity_key text not null,
  page_slug text not null,
  mention_count integer not null default 0,
  citation_count integer not null default 0,
  recommendation_count integer not null default 0,
  avg_confidence numeric(6,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_date, channel, entity_key, page_slug)
);

create index if not exists idx_llm_recommendation_share_channel
  on llm_recommendation_share_snapshots (channel, snapshot_date desc, recommendation_count desc);

create table if not exists commercial_page_audits (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  template text not null,
  audited_date date not null default current_date,
  completeness_score integer not null default 0,
  readiness_status text not null default 'needs_work' check (readiness_status in ('strong', 'needs_work', 'critical')),
  present_fields jsonb not null default '[]'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (page_id, audited_date)
);

create index if not exists idx_commercial_page_audits_page
  on commercial_page_audits (page_id, audited_date desc);

create index if not exists idx_commercial_page_audits_score
  on commercial_page_audits (readiness_status, completeness_score asc, audited_date desc);
