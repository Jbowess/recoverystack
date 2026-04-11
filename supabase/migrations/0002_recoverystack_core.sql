create extension if not exists pgcrypto;

create table if not exists pages (
 id uuid primary key default gen_random_uuid(),
 slug text unique not null,
 template text not null,
 title text not null,
 meta_description text not null,
 h1 text not null,
 intro text,
 body_json jsonb,
 pillar_id uuid references pages(id),
 primary_keyword text,
 secondary_keywords text[],
 internal_links jsonb,
 schema_org jsonb,
 status text default 'draft',
 search_volume int,
 difficulty int,
 created_at timestamptz default now(),
 updated_at timestamptz default now(),
 published_at timestamptz
);

create table if not exists trends (
 id uuid primary key default gen_random_uuid(),
 term text unique not null,
 source text,
 score numeric,
 competition text,
 status text default 'new',
 created_at timestamptz default now()
);

create table if not exists products (
 id uuid primary key default gen_random_uuid(),
 name text unique,
 brand text,
 price_aud numeric,
 battery_days numeric,
 subscription_required boolean,
 unique_features text[],
 affiliate_url text,
 last_scraped timestamptz
);

create index if not exists idx_pages_template_status on pages(template, status);
create index if not exists idx_pages_pillar_id on pages(pillar_id);
create index if not exists idx_pages_primary_keyword on pages(primary_keyword);
create index if not exists idx_trends_status on trends(status);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_pages_updated_at on pages;
create trigger trg_pages_updated_at
before update on pages
for each row execute function set_updated_at();
