-- Admin audit log: records every admin action for accountability and debugging
create table if not exists admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,          -- e.g. 'approve_trend', 'publish_draft', 'run_pipeline'
  actor        text not null default 'admin',
  target_type  text,                   -- e.g. 'trend', 'page', 'component_library'
  target_id    text,                   -- id/slug of the affected entity
  metadata     jsonb,                  -- extra context (errors, counts, etc.)
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_log_action_idx      on admin_audit_log (action);
create index if not exists admin_audit_log_created_at_idx  on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx      on admin_audit_log (target_type, target_id);
