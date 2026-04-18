create table if not exists news_source_feeds (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  source_type text not null default 'rss',
  beat text not null default 'general_recovery',
  source_url text not null,
  site_url text,
  language text not null default 'en',
  country text,
  cadence text not null default 'daily',
  priority integer not null default 50,
  active boolean not null default true,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_source_feeds_active on news_source_feeds (active, priority desc);
create index if not exists idx_news_source_feeds_beat on news_source_feeds (beat, active);

create table if not exists news_source_events (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid references news_source_feeds(id) on delete set null,
  source_type text not null default 'rss',
  beat text not null default 'general_recovery',
  event_key text not null unique,
  title text not null,
  normalized_title text not null,
  summary text,
  url text not null,
  source_domain text,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  event_type text not null default 'news_update',
  relevance_score integer not null default 50,
  authority_score integer not null default 50,
  freshness_score integer not null default 50,
  status text not null default 'new',
  source_payload jsonb not null default '{}'::jsonb,
  extraction jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_source_events_status on news_source_events (status, relevance_score desc, discovered_at desc);
create index if not exists idx_news_source_events_published on news_source_events (published_at desc);
create index if not exists idx_news_source_events_domain on news_source_events (source_domain, published_at desc);
create index if not exists idx_news_source_events_type on news_source_events (event_type, published_at desc);

create table if not exists topic_entities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  canonical_name text not null,
  entity_type text not null default 'brand',
  beat text not null default 'general_recovery',
  summary text,
  site_url text,
  authority_score integer not null default 50,
  confidence_score integer not null default 50,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_topic_entities_type on topic_entities (entity_type, authority_score desc);
create index if not exists idx_topic_entities_beat on topic_entities (beat, authority_score desc);

create table if not exists topic_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references topic_entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'common_name',
  confidence_score integer not null default 70,
  created_at timestamptz not null default now(),
  unique (entity_id, normalized_alias)
);

create index if not exists idx_topic_entity_aliases_norm on topic_entity_aliases (normalized_alias);

create table if not exists news_event_entities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references news_source_events(id) on delete cascade,
  entity_id uuid not null references topic_entities(id) on delete cascade,
  relationship_type text not null default 'mentions',
  confidence_score integer not null default 60,
  created_at timestamptz not null default now(),
  unique (event_id, entity_id, relationship_type)
);

create index if not exists idx_news_event_entities_event on news_event_entities (event_id);
create index if not exists idx_news_event_entities_entity on news_event_entities (entity_id, confidence_score desc);

create table if not exists storylines (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  normalized_title text not null,
  beat text not null default 'general_recovery',
  storyline_type text not null default 'developing',
  status text not null default 'active',
  canonical_entity_id uuid references topic_entities(id) on delete set null,
  lead_event_id uuid references news_source_events(id) on delete set null,
  lead_page_id uuid references pages(id) on delete set null,
  latest_event_at timestamptz,
  latest_publication_at timestamptz,
  authority_score integer not null default 50,
  freshness_score integer not null default 50,
  update_count integer not null default 0,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_storylines_status on storylines (status, latest_event_at desc);
create index if not exists idx_storylines_entity on storylines (canonical_entity_id, latest_event_at desc);
create index if not exists idx_storylines_beat on storylines (beat, freshness_score desc);

create table if not exists storyline_events (
  id uuid primary key default gen_random_uuid(),
  storyline_id uuid not null references storylines(id) on delete cascade,
  event_id uuid not null references news_source_events(id) on delete cascade,
  event_order integer not null default 0,
  significance_score integer not null default 50,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (storyline_id, event_id)
);

create index if not exists idx_storyline_events_storyline on storyline_events (storyline_id, event_order asc, created_at asc);
create index if not exists idx_storyline_events_event on storyline_events (event_id);

create table if not exists page_storylines (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  storyline_id uuid not null references storylines(id) on delete cascade,
  relationship_type text not null default 'primary_coverage',
  created_at timestamptz not null default now(),
  unique (page_id, storyline_id, relationship_type)
);

create index if not exists idx_page_storylines_page on page_storylines (page_id);
create index if not exists idx_page_storylines_storyline on page_storylines (storyline_id);

create table if not exists entity_coverage_daily (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references topic_entities(id) on delete cascade,
  date date not null,
  page_count integer not null default 0,
  news_page_count integer not null default 0,
  storyline_count integer not null default 0,
  source_event_count integer not null default 0,
  authority_score integer not null default 0,
  created_at timestamptz not null default now(),
  unique (entity_id, date)
);

create index if not exists idx_entity_coverage_daily_date on entity_coverage_daily (date desc);
create index if not exists idx_entity_coverage_daily_entity on entity_coverage_daily (entity_id, date desc);

create table if not exists page_update_log (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  page_slug text not null,
  update_type text not null default 'story_update',
  reason text,
  summary text,
  source_event_id uuid references news_source_events(id) on delete set null,
  storyline_id uuid references storylines(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_update_log_page on page_update_log (page_id, created_at desc);
create index if not exists idx_page_update_log_storyline on page_update_log (storyline_id, created_at desc);

alter table if exists pages add column if not exists content_type text;
alter table if exists pages add column if not exists news_format text;
alter table if exists pages add column if not exists beat text;
alter table if exists pages add column if not exists freshness_tier text;
alter table if exists pages add column if not exists last_verified_at timestamptz;
alter table if exists pages add column if not exists story_status text;
alter table if exists pages add column if not exists source_event_id uuid references news_source_events(id) on delete set null;
alter table if exists pages add column if not exists storyline_id uuid references storylines(id) on delete set null;

create index if not exists idx_pages_content_type on pages (content_type, published_at desc);
create index if not exists idx_pages_storyline on pages (storyline_id, updated_at desc);
create index if not exists idx_pages_beat on pages (beat, published_at desc);
