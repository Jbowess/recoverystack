create table if not exists distribution_assets (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  page_slug text not null,
  page_template text,
  channel text not null,
  asset_type text not null,
  status text not null default 'draft',
  title text,
  hook text,
  summary text,
  body text,
  cta_label text,
  cta_url text,
  hashtags text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  source_url text,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(page_id, channel, asset_type)
);

create index if not exists idx_distribution_assets_channel_status
  on distribution_assets(channel, status, created_at desc);

create index if not exists idx_distribution_assets_page_slug
  on distribution_assets(page_slug, channel);

create table if not exists outreach_queue (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  page_slug text not null,
  channel text not null default 'affiliate_outreach',
  target_name text not null,
  target_domain text,
  target_type text not null default 'brand',
  status text not null default 'draft',
  angle text not null,
  subject text not null,
  body text not null,
  cta_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(page_slug, channel, target_name)
);

create index if not exists idx_outreach_queue_status
  on outreach_queue(status, created_at desc);

create table if not exists email_digest_issues (
  id uuid primary key default gen_random_uuid(),
  issue_date date not null unique,
  status text not null default 'draft',
  subject text not null,
  preheader text,
  intro text,
  sections jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists distribution_asset_metrics (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references distribution_assets(id) on delete cascade,
  metric_date date not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  engagements integer not null default 0,
  conversions integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(asset_id, metric_date)
);

create index if not exists idx_distribution_asset_metrics_date
  on distribution_asset_metrics(metric_date desc);
