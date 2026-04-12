create table if not exists published_links_feed (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete set null,
  slug text not null unique,
  template text not null,
  title text,
  url text not null,
  published_at timestamptz not null default now(),
  source text not null default 'pipeline',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_published_links_feed_published_at on published_links_feed(published_at desc);

create or replace function set_published_links_feed_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_published_links_feed_updated_at on published_links_feed;
create trigger trg_published_links_feed_updated_at
before update on published_links_feed
for each row execute function set_published_links_feed_updated_at();
