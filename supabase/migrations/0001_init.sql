create extension if not exists pgcrypto;

create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  template text not null check (template in ('guides','alternatives','protocols','metrics','costs','compatibility','trends','pillars')),
  pillar_slug text,
  slug text not null unique,
  title text not null,
  meta_title text,
  meta_description text,
  h1 text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  target_keyword text,
  competitor text,
  sport text,
  injury text,
  metric text,
  content_markdown text not null default '',
  faq_json jsonb not null default '[]'::jsonb,
  schema_json jsonb,
  cta_variant text not null default 'default',
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists internal_links (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references pages(id) on delete cascade,
  target_page_id uuid not null references pages(id) on delete cascade,
  anchor_text text not null,
  score numeric not null default 0,
  created_at timestamptz not null default now(),
  unique(source_page_id, target_page_id, anchor_text)
);

create table if not exists trend_queue (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  term text not null,
  signal numeric,
  payload jsonb,
  discovered_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists content_gaps (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null,
  keyword text not null,
  missing_entities jsonb not null default '[]'::jsonb,
  serp_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_pages_template_status on pages(template, status);
create index if not exists idx_pages_pillar on pages(pillar_slug);
create index if not exists idx_trend_queue_processed on trend_queue(processed_at);
