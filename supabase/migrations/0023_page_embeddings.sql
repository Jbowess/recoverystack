-- Semantic embeddings for pages using pgvector
-- Enables cosine-similarity search for: cannibalization detection,
-- cross-linking suggestions, and keyword cluster gap analysis.
--
-- Requires the pgvector extension (available on Supabase by default).
-- Enable it in your Supabase dashboard: Extensions → vector

create extension if not exists vector;

create table if not exists page_embeddings (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references pages(id) on delete cascade,
  page_slug    text not null unique,
  model        text not null default 'text-embedding-3-small',
  embedding    vector(1536),
  content_hash text not null,  -- sha256 of the text used — skip re-embed if unchanged
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists page_embeddings_page_id_idx on page_embeddings (page_id);
create index if not exists page_embeddings_slug_idx on page_embeddings (page_slug);

-- HNSW index for fast approximate nearest-neighbour search
-- (cosine distance — equivalent to cosine similarity via 1 - distance)
create index if not exists page_embeddings_hnsw_idx
  on page_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Helper function: find the N most similar pages to a given page slug
create or replace function find_similar_pages(
  target_slug text,
  match_count  int default 5,
  min_similarity float default 0.7
)
returns table (
  slug        text,
  template    text,
  title       text,
  similarity  float
)
language sql stable
as $$
  with target as (
    select embedding from page_embeddings where page_slug = target_slug limit 1
  )
  select
    p.slug,
    p.template,
    p.title,
    1 - (pe.embedding <=> t.embedding) as similarity
  from page_embeddings pe
  join pages p on p.id = pe.page_id
  cross join target t
  where pe.page_slug <> target_slug
    and p.status = 'published'
    and 1 - (pe.embedding <=> t.embedding) >= min_similarity
  order by pe.embedding <=> t.embedding
  limit match_count;
$$;
