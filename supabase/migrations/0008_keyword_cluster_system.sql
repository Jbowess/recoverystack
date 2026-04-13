create table if not exists keyword_queue (
  id uuid primary key default gen_random_uuid(),
  cluster_name text not null,
  intent text,
  primary_keyword text not null,
  template_id text not null check (template_id in ('comparison', 'guide', 'protocol')),
  priority integer not null default 50,
  source text not null check (source in ('evergreen', 'trend')),
  status text not null default 'new' check (status in ('new', 'queued', 'generated', 'published', 'skipped')),
  score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_generated_at timestamptz
);

create unique index if not exists idx_keyword_queue_cluster_keyword on keyword_queue (cluster_name, primary_keyword);
create index if not exists idx_keyword_queue_status_priority on keyword_queue (status, priority desc, created_at asc);
create index if not exists idx_keyword_queue_source_status on keyword_queue (source, status, priority desc);
create index if not exists idx_keyword_queue_template on keyword_queue (template_id);

create table if not exists cluster_metrics (
  cluster_name text primary key,
  generated_count integer not null default 0,
  published_count integer not null default 0,
  avg_position numeric,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  ctr numeric,
  updated_at timestamptz not null default now()
);

create or replace function set_keyword_queue_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_keyword_queue_updated_at on keyword_queue;
create trigger trg_keyword_queue_updated_at
before update on keyword_queue
for each row execute function set_keyword_queue_updated_at();

-- Seed cluster queue with initial cluster keywords.
-- Template mapping requested:
--   comparison: cluster 1
--   guide: clusters 2,5,6
--   protocol: clusters 3,4
insert into keyword_queue (cluster_name, intent, primary_keyword, template_id, priority, source, status, score, metadata)
values
  -- cluster 1: comparison
  ('cluster-1-device-comparisons', 'commercial', 'oura ring vs whoop', 'comparison', 95, 'evergreen', 'new', 0.95, jsonb_build_object('seeded', true, 'cluster_id', 1)),
  ('cluster-1-device-comparisons', 'commercial', 'best recovery ring comparison', 'comparison', 92, 'evergreen', 'new', 0.92, jsonb_build_object('seeded', true, 'cluster_id', 1)),
  ('cluster-1-device-comparisons', 'commercial', 'whoop alternatives 2026', 'comparison', 88, 'trend', 'new', 0.88, jsonb_build_object('seeded', true, 'cluster_id', 1)),

  -- cluster 2: guide
  ('cluster-2-sleep-recovery-guides', 'informational', 'how to improve deep sleep for recovery', 'guide', 90, 'evergreen', 'new', 0.90, jsonb_build_object('seeded', true, 'cluster_id', 2)),
  ('cluster-2-sleep-recovery-guides', 'informational', 'sleep debt recovery guide athletes', 'guide', 86, 'evergreen', 'new', 0.86, jsonb_build_object('seeded', true, 'cluster_id', 2)),
  ('cluster-2-sleep-recovery-guides', 'informational', 'circadian rhythm reset after travel', 'guide', 80, 'trend', 'new', 0.80, jsonb_build_object('seeded', true, 'cluster_id', 2)),

  -- cluster 3: protocol
  ('cluster-3-cold-heat-protocols', 'transactional', 'cold plunge protocol after training', 'protocol', 91, 'evergreen', 'new', 0.91, jsonb_build_object('seeded', true, 'cluster_id', 3)),
  ('cluster-3-cold-heat-protocols', 'transactional', 'sauna recovery protocol weekly schedule', 'protocol', 89, 'evergreen', 'new', 0.89, jsonb_build_object('seeded', true, 'cluster_id', 3)),
  ('cluster-3-cold-heat-protocols', 'transactional', 'contrast therapy protocol for soreness', 'protocol', 83, 'trend', 'new', 0.83, jsonb_build_object('seeded', true, 'cluster_id', 3)),

  -- cluster 4: protocol
  ('cluster-4-injury-return-protocols', 'transactional', 'hamstring return to run protocol', 'protocol', 88, 'evergreen', 'new', 0.88, jsonb_build_object('seeded', true, 'cluster_id', 4)),
  ('cluster-4-injury-return-protocols', 'transactional', 'achilles rehab load progression protocol', 'protocol', 87, 'evergreen', 'new', 0.87, jsonb_build_object('seeded', true, 'cluster_id', 4)),
  ('cluster-4-injury-return-protocols', 'transactional', 'ankle sprain return to sport timeline', 'protocol', 82, 'trend', 'new', 0.82, jsonb_build_object('seeded', true, 'cluster_id', 4)),

  -- cluster 5: guide
  ('cluster-5-nutrition-recovery-guides', 'informational', 'post workout recovery nutrition guide', 'guide', 87, 'evergreen', 'new', 0.87, jsonb_build_object('seeded', true, 'cluster_id', 5)),
  ('cluster-5-nutrition-recovery-guides', 'informational', 'electrolyte timing for endurance recovery', 'guide', 84, 'evergreen', 'new', 0.84, jsonb_build_object('seeded', true, 'cluster_id', 5)),
  ('cluster-5-nutrition-recovery-guides', 'informational', 'creatine recovery benefits athletes', 'guide', 79, 'trend', 'new', 0.79, jsonb_build_object('seeded', true, 'cluster_id', 5)),

  -- cluster 6: guide
  ('cluster-6-training-load-guides', 'informational', 'heart rate variability training load guide', 'guide', 90, 'evergreen', 'new', 0.90, jsonb_build_object('seeded', true, 'cluster_id', 6)),
  ('cluster-6-training-load-guides', 'informational', 'deload week guide for strength athletes', 'guide', 85, 'evergreen', 'new', 0.85, jsonb_build_object('seeded', true, 'cluster_id', 6)),
  ('cluster-6-training-load-guides', 'informational', 'best readiness score thresholds', 'guide', 78, 'trend', 'new', 0.78, jsonb_build_object('seeded', true, 'cluster_id', 6))
on conflict (cluster_name, primary_keyword) do nothing;
