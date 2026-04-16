/**
 * content-refresh-processor.ts
 *
 * Processes approved items from the content_refresh_queue:
 *   1. Fetches rows with status='approved'
 *   2. Marks the queue item 'processing'
 *   3. Runs content-generator for each page (single-page mode via CONTENT_GENERATE_PAGE_ID)
 *   4. Marks queue item 'completed' on success or 'failed' on error
 *
 * Called by nightly-run as a separate phase so failures don't block the main pipeline.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase env vars');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Max approved items to process per nightly run (safety cap)
const MAX_ITEMS = Number(process.env.REFRESH_PROCESSOR_MAX_ITEMS ?? 5);

type QueueItem = {
  id: string;
  page_id: string;
  slug: string;
  reason: string;
  priority: number | null;
};

async function loadApprovedItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from('content_refresh_queue')
    .select('id,page_id,slug,reason,priority')
    .eq('status', 'approved')
    .order('priority', { ascending: false, nullsFirst: false })
    .order('queued_at', { ascending: true })
    .limit(MAX_ITEMS);

  if (error) throw error;
  return (data ?? []) as QueueItem[];
}

function runContentGenerator(pageId: string): boolean {
  const result = spawnSync('npx', ['tsx', 'scripts/content-generator.ts'], {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, CONTENT_GENERATE_PAGE_ID: pageId },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result.status === 0;
}

async function run() {
  const items = await loadApprovedItems();

  if (!items.length) {
    console.log('[content-refresh-processor] no approved items to process');
    return;
  }

  console.log(`[content-refresh-processor] processing ${items.length} approved refresh item(s)`);

  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    console.log(`\n[content-refresh-processor] processing slug="${item.slug}" reason="${item.reason}"`);

    // Mark queue item as processing
    await supabase
      .from('content_refresh_queue')
      .update({ status: 'processing', processed_at: new Date().toISOString() })
      .eq('id', item.id);

    // Run content generator for this specific page
    const ok = runContentGenerator(item.page_id);

    if (ok) {
      await supabase
        .from('content_refresh_queue')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('id', item.id);
      console.log(`[content-refresh-processor] ✓ completed slug="${item.slug}"`);
      succeeded += 1;
    } else {
      await supabase
        .from('content_refresh_queue')
        .update({ status: 'failed', metadata: { error: 'content-generator exited non-zero' } })
        .eq('id', item.id);
      console.error(`[content-refresh-processor] ✗ failed slug="${item.slug}"`);
      failed += 1;
    }
  }

  console.log(
    `\n[content-refresh-processor] done. processed=${items.length} succeeded=${succeeded} failed=${failed}`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[content-refresh-processor] fatal error:', err);
  process.exit(1);
});
