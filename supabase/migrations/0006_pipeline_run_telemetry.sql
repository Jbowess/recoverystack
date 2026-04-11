create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists pipeline_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs(id) on delete cascade,
  step_key text not null,
  step_name text not null,
  step_index integer not null,
  total_steps integer not null,
  command text,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  exit_code integer,
  error_message text,
  artifact_log text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pipeline_runs_started_at on pipeline_runs (started_at desc);
create index if not exists idx_pipeline_runs_name_started_at on pipeline_runs (pipeline_name, started_at desc);
create index if not exists idx_pipeline_steps_run_index on pipeline_steps (run_id, step_index);
