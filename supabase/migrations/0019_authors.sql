-- Author entity table for E-E-A-T author pages
create table if not exists authors (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  title        text not null,
  bio          text,
  credentials  text[] not null default '{}',
  linkedin_url text,
  twitter_url  text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Seed with placeholder authors
insert into authors (slug, name, title, bio, credentials, linkedin_url)
values
  (
    'editorial-team',
    'RecoveryStack Editorial Team',
    'Sports Science & Recovery Technology Analysts',
    'Our editorial team combines expertise in sports science, exercise physiology, and health technology to deliver evidence-based recovery guidance.',
    ARRAY['Sports Science', 'Exercise Physiology', 'Health Technology'],
    'https://www.linkedin.com/company/recoverystack'
  )
on conflict (slug) do nothing;
