# Supabase Migrations

This repo stores the database schema in `supabase/migrations/`.

## What was fixed
- Added standard Supabase CLI project config with `supabase init`.
- Removed duplicate migration version prefixes so the migration history is strictly ordered.

The current migration stream is now suitable for `supabase db push`, assuming you provide a real authenticated database connection path.

## Preflight
Run:

```bash
npm run supabase:migrations:check
```

This validates:
- every migration filename has a numeric prefix
- prefixes are unique
- migration order is strictly increasing

## Apply to Supabase
You need one of these:

1. A linked Supabase project via CLI auth
2. A direct Postgres connection string in `SUPABASE_DB_URL`

### Option A: linked project
```bash
npx supabase login
npx supabase link --project-ref wnzwexgzarfbaywnbdph
npm run supabase:push
```

### Option B: direct DB URL
Put a real Postgres connection string in `SUPABASE_DB_URL`, then run:

```bash
npm run supabase:push -- --db-url "$SUPABASE_DB_URL"
```

On PowerShell:

```powershell
npm run supabase:push -- --db-url "$env:SUPABASE_DB_URL"
```

## Inspect migration state
```bash
npm run supabase:migrations:list
```

For a direct DB URL:

```bash
npm run supabase:migrations:list -- --db-url "$SUPABASE_DB_URL"
```

## Important constraint
This repo currently has Supabase API keys but does not have a populated `SUPABASE_DB_URL` or CLI auth session. Without one of those, migrations cannot be pushed to the hosted database from this machine.
