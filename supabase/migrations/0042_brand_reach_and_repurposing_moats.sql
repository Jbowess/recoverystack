create table if not exists brand_reach_snapshots (
  snapshot_date date primary key,
  branded_search_score integer not null default 0,
  creator_mentions integer not null default 0,
  press_mentions integer not null default 0,
  outreach_wins integer not null default 0,
  newsletter_assets integer not null default 0,
  reach_assets integer not null default 0,
  total_assets integer not null default 0,
  conversions integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists repurposing_priority_scores (
  page_slug text primary key,
  priority_score integer not null default 0,
  score_breakdown jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists tool_idea_queue (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null,
  idea_type text not null check (idea_type in ('calculator', 'selector', 'checker', 'worksheet', 'quiz', 'matrix')),
  title text not null,
  rationale text not null,
  priority integer not null default 50,
  status text not null default 'draft' check (status in ('draft', 'approved', 'built', 'skipped')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(page_slug, idea_type)
);

create index if not exists tool_idea_queue_status_idx on tool_idea_queue (status, priority desc, created_at desc);

create table if not exists brand_frameworks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  use_cases text[] not null default '{}',
  example_lines text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_frameworks_status_idx on brand_frameworks (status, updated_at desc);
