# RecoveryStack pSEO System

Phase 1 scaffold is complete:
- Next.js app routes for 8 SEO templates
- Supabase client + base schema migration
- Core conversion components
- Script placeholders for scrape/gap/generate/link/deploy
- Prompt files per template

## Quick start
1. `npm install`
2. Copy `.env.example` to `.env.local`
3. Fill required env values
4. Run `npm run dev`

## Daily orchestration runbook
Use the unified orchestration script to run the full daily content pipeline in order:

1. trend-scraper
2. gap-analyzer
3. content-generator
4. linker
5. deploy

### Run the full daily flow
```bash
npm run daily:run
```

This command is fail-fast: if any step exits non-zero, orchestration stops immediately and returns that exit code.

### Backward-compatible alias
```bash
npm run pipeline:run
```

`pipeline:run` points to the same unified daily orchestration script.

## Nightly automation runbook (cron-friendly)
Nightly automation chains these jobs in order and fails fast on the first error:
1. `npm run daily:run`
2. `npm run gsc:sync`
3. `npm run content:refresh`

### Run nightly automation manually
```bash
npm run nightly:run
```

(Equivalent direct invocation)
```bash
npx tsx scripts/nightly-run.ts
```

`scripts/nightly-run.ts` emits structured JSON logs (`nightly.start`, `step.start`, `step.succeeded`, `step.failed`, `nightly.succeeded`) and exits non-zero if any step fails.

### Sample GitHub Actions schedule
Create `.github/workflows/nightly-run.yml`:

```yaml
name: Nightly RecoveryStack Run

on:
  schedule:
    # 03:15 UTC daily
    - cron: '15 3 * * *'
  workflow_dispatch:

jobs:
  nightly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run nightly:run
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          GSC_CLIENT_EMAIL: ${{ secrets.GSC_CLIENT_EMAIL }}
          GSC_PRIVATE_KEY: ${{ secrets.GSC_PRIVATE_KEY }}
          GSC_SITE_URL: ${{ secrets.GSC_SITE_URL }}
```

### Vercel Cron notes
- Vercel cron can only call HTTP endpoints (it cannot run `npm` scripts directly).
- To use Vercel cron, create a protected route (for example `/api/cron/nightly`) that triggers the same pipeline logic server-side.
- Add your cron schedule in `vercel.json`, then configure `CRON_SECRET` and required pipeline env vars in the Vercel project settings.
- Keep one scheduler as the source of truth (GitHub Actions **or** Vercel cron) to avoid duplicate nightly runs.

### Run individual steps
```bash
npm run trend:scrape
npm run gap:analyze
npm run content:generate
npm run links:rebuild
npm run deploy:trigger
```

## Smoke-test seed (idempotent)
Run a safe end-to-end dry smoke test that upserts 5 pages, 5 products, and 5 trends, then runs linker + deploy in dry-run mode:

`npm run smoke:seed`

Notes:
- Script: `scripts/smoke-seed.ts`
- Upserts use unique keys (`pages.slug`, `products.name`, `trends.term`) so reruns are safe.
- Linker/deploy dry mode can also be run directly:
  - `npm run links:rebuild -- --dry-run`
  - `npm run deploy:trigger -- --dry-run`
- Link verification mode (no writes; fails on generic anchors or invalid cluster link counts):
  - `npm run links:rebuild -- --verify`

## Next phase targets
- Build full content renderer with schema.org + FAQ blocks
- Implement production Supabase access layer (service-role writer + RLS)
- Implement trend scraper and content generation pipeline
