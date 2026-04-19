/**
 * Schema Backfill
 *
 * Populates schema_org for all published pages that currently have null or
 * empty schema_org. Pages generated before schema wiring was in place need
 * this one-time backfill; new pages get schema_org via buildGeneratedPageUpdate.
 *
 * Usage:
 *   npx tsx scripts/schema-backfill.ts
 *   npx tsx scripts/schema-backfill.ts --dry-run
 *   npx tsx scripts/schema-backfill.ts --all   (overwrite even non-null schema)
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildSchemaOrgForPage } from '@/lib/page-state';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const OVERWRITE_ALL = process.argv.includes('--all');

async function run() {
  // Select only columns confirmed to exist in the live DB (metadata added by migration 0023)
  const query = supabase
    .from('pages')
    .select('id, slug, template, title, meta_title, meta_description, h1, intro, body_json, pillar_id, primary_keyword, secondary_keywords, internal_links, schema_org, status, published_at, updated_at')
    .eq('status', 'published');

  if (!OVERWRITE_ALL) {
    query.is('schema_org', null);
  }

  const { data: pages, error } = await query;
  if (error) throw error;
  if (!pages || pages.length === 0) {
    console.log('[schema-backfill] no pages need backfill');
    return;
  }

  console.log(`[schema-backfill] backfilling ${pages.length} page(s) (dryRun=${DRY_RUN})`);

  let updated = 0;
  let failed = 0;

  for (const page of pages) {
    try {
      // Inject empty metadata so buildSchemaOrgForPage falls back to defaults (migration 0023 not yet applied)
      const schemaOrg = buildSchemaOrgForPage({ ...page, metadata: {} } as any);

      if (!schemaOrg || schemaOrg.length === 0) {
        console.warn(`[schema-backfill] empty schema for '${page.slug}' — skipping`);
        continue;
      }

      console.log(`[schema-backfill] ${page.slug} (${page.template}) — ${schemaOrg.length} schema blocks`);

      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('pages')
          .update({ schema_org: schemaOrg })
          .eq('id', page.id);
        if (updateErr) throw updateErr;
      }

      updated++;
    } catch (err) {
      console.error(`[schema-backfill] failed for '${page.slug}':`, err);
      failed++;
    }
  }

  console.log(`[schema-backfill] done. updated=${updated} failed=${failed}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
