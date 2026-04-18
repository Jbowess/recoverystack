create table if not exists serp_snapshot_history (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  normalized_keyword text not null,
  snapshot_date date not null default current_date,
  source text not null default 'internal',
  top_results jsonb not null default '[]'::jsonb,
  paa_questions jsonb not null default '[]'::jsonb,
  related_searches jsonb not null default '[]'::jsonb,
  features jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(normalized_keyword, snapshot_date, source)
);

create table if not exists competitor_page_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_slug text not null,
  source_url text not null,
  page_title text,
  page_type text,
  keyword text,
  snapshot_date date not null default current_date,
  summary text,
  differentiators text[] not null default '{}',
  pricing_signals jsonb not null default '{}'::jsonb,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(competitor_slug, source_url, snapshot_date)
);

create table if not exists community_topic_mentions (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null,
  source_url text,
  topic_slug text not null,
  title text,
  sentiment text,
  mention_count integer not null default 1,
  pain_points text[] not null default '{}',
  desired_outcomes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table if not exists creator_relationships (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  primary_platform text not null,
  handle text,
  audience_segment text,
  relevance_score integer not null default 50,
  relationship_stage text not null default 'identified' check (relationship_stage in ('identified', 'qualified', 'contacted', 'responded', 'active', 'inactive')),
  partnership_fit text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists outreach_reply_log (
  id uuid primary key default gen_random_uuid(),
  outreach_queue_id uuid,
  target_slug text,
  channel text not null,
  reply_status text not null check (reply_status in ('no_reply', 'interested', 'declined', 'follow_up', 'won')),
  reply_summary text,
  reply_date timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists conversion_experiments (
  id uuid primary key default gen_random_uuid(),
  page_slug text not null,
  experiment_type text not null,
  variant_a text not null,
  variant_b text not null,
  target_metric text not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'won', 'lost', 'archived')),
  confidence_score numeric(6,3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audience_segments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  description text,
  buyer_traits text[] not null default '{}',
  keywords text[] not null default '{}',
  preferred_ctas text[] not null default '{}',
  content_angles text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brand_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  tone_rules text[] not null default '{}',
  banned_phrases text[] not null default '{}',
  required_frames text[] not null default '{}',
  example_lines text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  label text not null,
  policy_type text not null,
  enabled boolean not null default true,
  severity text not null default 'medium',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pipeline_retry_jobs (
  id uuid primary key default gen_random_uuid(),
  step_key text not null,
  run_context text,
  status text not null default 'pending' check (status in ('pending', 'running', 'resolved', 'failed', 'aborted')),
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  next_retry_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lead_magnet_offers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  format text not null,
  target_segment text,
  primary_cta text not null,
  destination_url text,
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tool_usage_events (
  id uuid primary key default gen_random_uuid(),
  tool_slug text not null,
  session_id text,
  event_type text not null,
  page_slug text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
