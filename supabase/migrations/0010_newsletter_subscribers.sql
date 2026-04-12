-- Newsletter subscribers table
create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'newsletter_form',
  page_template text,
  subscribed_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

create index if not exists idx_newsletter_subscribers_email on newsletter_subscribers (email);
create index if not exists idx_newsletter_subscribers_source on newsletter_subscribers (source);
