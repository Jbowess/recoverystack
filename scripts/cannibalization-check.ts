/**
 * Keyword cannibalization check.
 *
 * Finds published pages sharing the same primary_keyword. Competing pages split
 * PageRank authority and confuse Google about which URL to rank.
 *
 * Outputs a warning table and logs each conflict to admin_audit_log.
 * Does NOT automatically redirect or unpublish — flags for human review.
 *
 * Exit 0 even when conflicts are found so the pipeline is not blocked.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

type PageRow = {
  id: string;
  slug: string;
  template: string;
  primary_keyword: string;
  search_volume: number | null;
  metadata: Record<string, unknown> | null;
};

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,primary_keyword,search_volume,metadata')
    .eq('status', 'published')
    .not('primary_keyword', 'is', null)
    .order('primary_keyword', { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as PageRow[];

  // Group by normalised primary_keyword
  const byKeyword = new Map<string, PageRow[]>();
  for (const row of rows) {
    const key = row.primary_keyword.toLowerCase().trim();
    if (!byKeyword.has(key)) byKeyword.set(key, []);
    byKeyword.get(key)!.push(row);
  }

  const conflicts: Array<{ keyword: string; pages: PageRow[] }> = [];
  for (const [keyword, pages] of byKeyword) {
    if (pages.length > 1) conflicts.push({ keyword, pages });
  }

  if (!conflicts.length) {
    console.log('[cannibalization-check] No keyword conflicts found.');
    return;
  }

  console.warn(`\n[cannibalization-check] Found ${conflicts.length} cannibalized keyword(s):\n`);
  console.warn('  Keyword'.padEnd(50) + '  Slugs (keep → redirect)');
  console.warn('  ' + '-'.repeat(80));

  for (const { keyword, pages } of conflicts) {
    // Prefer the page with the highest impressions as the canonical
    const sorted = [...pages].sort(
      (a, b) =>
        ((b.metadata?.gsc_impressions as number | null) ?? 0) -
        ((a.metadata?.gsc_impressions as number | null) ?? 0),
    );
    const keep = sorted[0];
    const redirects = sorted.slice(1);

    const slugList = `${keep.slug} (keep) → ${redirects.map((r) => r.slug).join(', ')} (redirect)`;
    console.warn(`  ${keyword.slice(0, 48).padEnd(50)}  ${slugList}`);

    // Log to admin_audit_log (non-blocking)
    try {
      await supabase.from('admin_audit_log').insert({
        action: 'cannibalization_detected',
        actor: 'system',
        target_type: 'keyword',
        target_id: keyword,
        metadata: {
          keep_slug: keep.slug,
          redirect_slugs: redirects.map((r) => r.slug),
          page_count: pages.length,
        },
      });
    } catch {
      // Non-fatal — audit log failure must not break the pipeline
    }
  }

  console.warn(`\n[cannibalization-check] Action required: add redirects for ${conflicts.reduce((sum, c) => sum + c.pages.length - 1, 0)} page(s).\n`);
}

run().catch((err) => {
  console.error('[cannibalization-check] Failed:', err);
  process.exit(1);
});
