# Repo Structure

This repo is operating more like a content and growth system than a small Next.js app. The goal of this layout is to keep the root stable and make the flat script layer easier to navigate without breaking imports.

## Top level
- `app/`: Next.js routes, API handlers, and page entry points.
- `components/`: reusable UI and conversion components.
- `lib/`: shared runtime logic, Supabase access, page rendering helpers, linking, growth, and distribution engines.
- `scripts/`: operational CLI layer for SEO, editorial, data, distribution, and automation jobs.
- `supabase/`: migrations and database-side schema history.
- `docs/`: system context, standards, and repo navigation docs.
- `public/`, `images/`: static assets.
- `content-prompts/`: prompt templates used by generation jobs.

## Script grouping
The `scripts/` directory is intentionally flat so scripts stay runnable and easy to reference from `package.json`. Treat it as a command surface, not a domain model.

Use [`scripts/README.md`](../scripts/README.md) as the script index. Scripts are grouped there by function:
- orchestration
- discovery and intelligence
- content and page generation
- data truth and product intelligence
- SEO optimization and quality
- distribution and repurposing
- CRM, outreach, and performance

## Cleanup conventions
- Keep generated logs out of git. Dev logs belong in local ignored files.
- Add new documentation under `docs/`, not the repo root, unless it is the main `README.md`.
- Prefer adding new shared logic to `lib/` and keeping `scripts/` thin wrappers around that logic.
- If a script grows into a reusable subsystem, move the reusable parts into `lib/` before adding more flags.
- Keep root-level files limited to project config, main docs, and runtime entrypoints.

## When to reorganize further
Avoid large directory moves unless one of these is true:
- imports are repeatedly hard to find even with the script index
- multiple scripts share duplicated logic that should live in `lib/`
- a new subsystem needs its own internal package or module boundary

At the current size, documentation and naming cleanup is lower risk than moving every script into nested folders.
