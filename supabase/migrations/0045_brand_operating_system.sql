create table if not exists brand_memory_entries (
  id uuid primary key default gen_random_uuid(),
  memory_key text not null unique,
  memory_type text not null check (memory_type in ('thesis', 'claim', 'objection', 'hook', 'proof', 'relationship', 'campaign_learning', 'persona_signal')),
  source_type text not null,
  source_key text not null,
  title text,
  body text not null,
  tags text[] not null default '{}',
  priority integer not null default 50,
  confidence_score integer not null default 50,
  freshness_score integer not null default 50,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_memory_type_priority
  on brand_memory_entries (memory_type, priority desc, updated_at desc);

create table if not exists narrative_control_centers (
  id uuid primary key default gen_random_uuid(),
  narrative_key text not null unique,
  title text not null,
  narrative_type text not null check (narrative_type in ('primary_thesis', 'supporting_thesis', 'anti_thesis', 'message_house', 'campaign_narrative')),
  status text not null default 'active' check (status in ('active', 'testing', 'archived')),
  thesis text not null,
  proof_requirements text[] not null default '{}',
  approved_frames text[] not null default '{}',
  disallowed_phrasing text[] not null default '{}',
  target_personas text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists narrative_message_frames (
  id uuid primary key default gen_random_uuid(),
  narrative_key text not null,
  frame_key text not null,
  channel text,
  frame_type text not null check (frame_type in ('hook', 'cta', 'proof', 'counter_argument', 'positioning')),
  message text not null,
  status text not null default 'active' check (status in ('active', 'testing', 'retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(narrative_key, frame_key, coalesce(channel, ''), frame_type)
);

create table if not exists share_of_voice_snapshots (
  snapshot_date date not null,
  market_slug text not null,
  topic_slug text not null,
  channel text not null,
  visibility_score integer not null default 0,
  engagement_score integer not null default 0,
  conversion_score integer not null default 0,
  authority_score integer not null default 0,
  competitor_pressure_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_date, market_slug, topic_slug, channel)
);

create index if not exists idx_share_of_voice_market
  on share_of_voice_snapshots (market_slug, snapshot_date desc, visibility_score desc);

create table if not exists influence_graph_nodes (
  id uuid primary key default gen_random_uuid(),
  node_key text not null unique,
  node_type text not null check (node_type in ('creator', 'journalist', 'community', 'brand', 'partner', 'publication', 'channel')),
  label text not null,
  domain text,
  platform text,
  audience_segment text,
  influence_score integer not null default 0,
  relationship_score integer not null default 0,
  amplification_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_influence_graph_nodes_type
  on influence_graph_nodes (node_type, influence_score desc);

create table if not exists influence_graph_edges (
  id uuid primary key default gen_random_uuid(),
  source_node_key text not null,
  target_node_key text not null,
  edge_type text not null check (edge_type in ('audience_overlap', 'distribution_fit', 'relationship', 'competitive', 'co_mention')),
  strength_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source_node_key, target_node_key, edge_type)
);

create table if not exists campaign_portfolios (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique,
  title text not null,
  objective text not null,
  market_slug text not null default 'smart_ring',
  channel_mix text[] not null default '{}',
  expected_reach integer not null default 0,
  expected_conversions integer not null default 0,
  actual_reach integer not null default 0,
  actual_conversions integer not null default 0,
  budget_score integer not null default 0,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists campaign_asset_map (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null,
  asset_id uuid,
  page_slug text,
  asset_channel text,
  asset_type text,
  role text not null default 'supporting',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(campaign_key, coalesce(asset_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(page_slug, ''), coalesce(asset_channel, ''), coalesce(asset_type, ''))
);

create table if not exists executive_attribution_rollups (
  snapshot_date date not null,
  market_slug text not null,
  channel text not null,
  first_touch_revenue_usd numeric(12,2) not null default 0,
  assisted_revenue_usd numeric(12,2) not null default 0,
  newsletter_assists integer not null default 0,
  product_assists integer not null default 0,
  content_influence_score integer not null default 0,
  creator_influence_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_date, market_slug, channel)
);

create table if not exists brand_moat_snapshots (
  snapshot_date date primary key,
  proprietary_dataset_count integer not null default 0,
  framework_count integer not null default 0,
  scoring_model_count integer not null default 0,
  creator_relationship_count integer not null default 0,
  repurposing_packet_count integer not null default 0,
  decision_asset_count integer not null default 0,
  moat_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists brand_risk_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  risk_type text not null check (risk_type in ('claim_risk', 'reputation', 'staleness', 'negative_sentiment', 'originality_decay', 'evidence_gap')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  page_slug text,
  source_key text,
  summary text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_risk_alerts_status
  on brand_risk_alerts (status, severity, created_at desc);

create table if not exists executive_cockpit_snapshots (
  snapshot_date date primary key,
  brand_score integer not null default 0,
  narrative_alignment_score integer not null default 0,
  share_of_voice_score integer not null default 0,
  influence_score integer not null default 0,
  attribution_score integer not null default 0,
  moat_score integer not null default 0,
  risk_score integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
