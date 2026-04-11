create table if not exists content_refresh_queue (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  slug text not null,
  reason text not null,
  stale_days int,
  low_traffic boolean not null default false,
  search_volume_snapshot int,
  status text not null default 'queued',
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(page_id)
);

create index if not exists idx_content_refresh_queue_status on content_refresh_queue(status, queued_at);
create index if not exists idx_content_refresh_queue_slug on content_refresh_queue(slug);

create or replace function set_content_refresh_queue_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_content_refresh_queue_updated_at on content_refresh_queue;
create trigger trg_content_refresh_queue_updated_at
before update on content_refresh_queue
for each row execute function set_content_refresh_queue_updated_at();
