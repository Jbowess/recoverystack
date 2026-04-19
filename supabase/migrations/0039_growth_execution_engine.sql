create table if not exists partner_contacts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  target_type text not null check (target_type in ('brand', 'creator', 'affiliate_network', 'press', 'community', 'retailer')),
  domain text,
  website_url text,
  primary_channel text,
  contact_email text,
  social_handle text,
  audience_fit text,
  niches text[] not null default '{}',
  partnership_angles text[] not null default '{}',
  priority integer not null default 50,
  status text not null default 'active' check (status in ('active', 'paused', 'inactive')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_contacts_target_type_idx on partner_contacts (target_type, status, priority desc);
create index if not exists partner_contacts_domain_idx on partner_contacts (domain);

create table if not exists channel_publication_queue (
  id uuid primary key default gen_random_uuid(),
  distribution_asset_id uuid,
  page_id uuid,
  page_slug text not null,
  channel text not null,
  publish_status text not null default 'pending_approval' check (publish_status in ('pending_approval', 'approved', 'scheduled', 'posted', 'failed', 'skipped')),
  publish_priority integer not null default 50,
  scheduled_for timestamptz,
  published_at timestamptz,
  target_account text,
  target_community text,
  approval_required boolean not null default true,
  body text not null,
  asset_title text,
  link_url text,
  platform_payload jsonb not null default '{}'::jsonb,
  performance_snapshot jsonb not null default '{}'::jsonb,
  external_post_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_publication_queue_asset_channel_idx
  on channel_publication_queue (distribution_asset_id, channel);
create index if not exists channel_publication_queue_status_idx
  on channel_publication_queue (publish_status, scheduled_for asc, publish_priority desc);

create table if not exists social_channel_metrics (
  id uuid primary key default gen_random_uuid(),
  publication_queue_id uuid,
  page_slug text not null,
  channel text not null,
  metric_date date not null default current_date,
  impressions integer not null default 0,
  clicks integer not null default 0,
  engagements integer not null default 0,
  shares integer not null default 0,
  saves integer not null default 0,
  comments integer not null default 0,
  followers_gained integer not null default 0,
  conversions integer not null default 0,
  revenue_usd numeric(12,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists social_channel_metrics_unique_idx
  on social_channel_metrics (publication_queue_id, metric_date);
create index if not exists social_channel_metrics_page_channel_idx
  on social_channel_metrics (page_slug, channel, metric_date desc);

create table if not exists editorial_trust_profiles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  profile_type text not null check (profile_type in ('methodology', 'review_standard', 'reviewer_profile', 'evidence_standard')),
  applies_to_templates text[] not null default '{}',
  evidence_requirements text[] not null default '{}',
  review_steps text[] not null default '{}',
  trust_signals text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists growth_roadmap_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  primary_keyword text not null,
  template text not null,
  intent text not null,
  funnel_stage text not null,
  cluster_name text not null,
  status text not null default 'planned' check (status in ('planned', 'queued', 'drafted', 'published', 'archived')),
  priority integer not null default 50,
  target_month text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists growth_roadmap_status_idx
  on growth_roadmap_items (status, priority desc);
create index if not exists growth_roadmap_cluster_idx
  on growth_roadmap_items (cluster_name, funnel_stage, priority desc);

create table if not exists product_truth_cards (
  id uuid primary key default gen_random_uuid(),
  product_slug text not null,
  card_type text not null check (card_type in ('positioning', 'faq', 'objection', 'use_case', 'claim', 'comparison_edge')),
  title text not null,
  body text not null,
  priority integer not null default 50,
  status text not null default 'active' check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_truth_cards_unique_idx
  on product_truth_cards (product_slug, card_type, title);
create index if not exists product_truth_cards_product_idx
  on product_truth_cards (product_slug, card_type, priority desc);
