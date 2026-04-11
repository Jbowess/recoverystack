create table if not exists compatibility_checker_submissions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  page_slug text not null,
  page_template text not null,
  answers jsonb not null,
  score int not null check (score >= 0 and score <= 100),
  recommendation text not null,
  source_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_compatibility_checker_created_at
  on compatibility_checker_submissions(created_at desc);

create index if not exists idx_compatibility_checker_page
  on compatibility_checker_submissions(page_template, page_slug);
