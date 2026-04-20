create table if not exists content_atoms (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  page_slug text not null,
  atom_type text not null,
  atom_label text,
  atom_text text not null,
  source_section text,
  audience_segment text,
  evidence_type text,
  strength_score integer not null default 50,
  fingerprint text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_content_atoms_page_slug on content_atoms (page_slug, atom_type);
create index if not exists idx_content_atoms_strength on content_atoms (strength_score desc, created_at desc);

create table if not exists repurposing_packets (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  page_slug text not null unique,
  packet_version text not null default 'v1_campaign_engine',
  packet_status text not null default 'ready' check (packet_status in ('ready', 'stale', 'archived')),
  summary jsonb not null default '{}'::jsonb,
  atoms jsonb not null default '[]'::jsonb,
  hooks jsonb not null default '[]'::jsonb,
  channel_bundles jsonb not null default '[]'::jsonb,
  visuals jsonb not null default '[]'::jsonb,
  learning_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_repurposing_packets_status on repurposing_packets (packet_status, updated_at desc);

create table if not exists channel_hook_library (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  page_slug text not null,
  channel text not null,
  hook_pattern text not null,
  hook_text text not null,
  fingerprint text not null,
  originality_score integer,
  predicted_reach_score integer,
  status text not null default 'candidate' check (status in ('candidate', 'promoted', 'retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_channel_hook_library_channel_status
  on channel_hook_library (channel, status, predicted_reach_score desc nulls last);
create index if not exists idx_channel_hook_library_fingerprint
  on channel_hook_library (fingerprint);

create table if not exists repurposing_originality_scores (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  page_slug text not null,
  asset_channel text not null,
  asset_type text not null,
  originality_score integer not null default 0,
  status text not null default 'pass' check (status in ('pass', 'review', 'fail')),
  nearest_match text,
  nearest_similarity numeric(6,3),
  breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_repurposing_originality_page
  on repurposing_originality_scores (page_slug, asset_channel, created_at desc);

create table if not exists asset_performance_learning (
  id uuid primary key default gen_random_uuid(),
  learned_on date not null default current_date,
  channel text not null,
  asset_type text not null,
  hook_pattern text,
  persona text,
  angle_type text,
  evidence_type text,
  sample_size integer not null default 0,
  avg_impressions numeric(12,2) not null default 0,
  avg_clicks numeric(12,2) not null default 0,
  avg_engagements numeric(12,2) not null default 0,
  avg_conversions numeric(12,2) not null default 0,
  avg_reach_score numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(learned_on, channel, asset_type, hook_pattern, persona, angle_type, evidence_type)
);

create index if not exists idx_asset_performance_learning_channel
  on asset_performance_learning (channel, learned_on desc, avg_reach_score desc);
