alter table pages add column if not exists llm_readiness_score integer;
alter table pages add column if not exists llm_readiness_status text;
alter table pages add column if not exists llm_last_scored_at timestamptz;
alter table pages add column if not exists llm_last_optimized_at timestamptz;

create index if not exists idx_pages_llm_readiness_score
  on pages (status, llm_readiness_score desc nulls last, updated_at desc);

create table if not exists page_entities (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  entity_key text not null,
  entity_name text not null,
  entity_type text not null default 'topic',
  salience_score integer not null default 50,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, entity_key)
);

create index if not exists idx_page_entities_page
  on page_entities (page_id, salience_score desc, entity_type);

create table if not exists page_llm_scores (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  score_date date not null default current_date,
  total_score integer not null,
  readiness_status text not null default 'needs_work',
  breakdown jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (page_id, score_date)
);

create index if not exists idx_page_llm_scores_page
  on page_llm_scores (page_id, score_date desc);

create index if not exists idx_page_llm_scores_total
  on page_llm_scores (total_score asc, score_date desc);

create table if not exists page_llm_observations (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  observation_key text not null,
  observation_type text not null,
  severity integer not null default 50,
  status text not null default 'open',
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (page_id, observation_key, status)
);

create index if not exists idx_page_llm_observations_page
  on page_llm_observations (page_id, status, severity desc, detected_at desc);

create table if not exists llm_query_simulations (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  normalized_query text not null,
  channel text not null default 'chatgpt',
  simulated_date date not null default current_date,
  matched_page_id uuid references pages(id) on delete set null,
  matched_page_slug text,
  confidence_score integer not null default 50,
  result_status text not null default 'candidate',
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (normalized_query, channel, simulated_date)
);

create index if not exists idx_llm_query_simulations_channel
  on llm_query_simulations (channel, simulated_date desc, confidence_score desc);

create table if not exists llm_referral_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'unknown',
  session_id text,
  slug text,
  page_template text,
  landing_url text not null,
  referrer_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_referral_events_source
  on llm_referral_events (source, created_at desc);

create index if not exists idx_llm_referral_events_slug
  on llm_referral_events (slug, created_at desc);

alter table conversion_events add column if not exists discovery_source text;
alter table conversion_events add column if not exists referrer_url text;
alter table conversion_events add column if not exists landing_url text;
alter table conversion_events add column if not exists utm_source text;
alter table conversion_events add column if not exists utm_medium text;
alter table conversion_events add column if not exists utm_campaign text;
alter table conversion_events add column if not exists session_id text;
alter table conversion_events add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_conversion_events_discovery_source
  on conversion_events (discovery_source, created_at desc);
