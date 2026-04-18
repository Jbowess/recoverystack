import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { AUTOMATION_POLICY_SEEDS } from '@/lib/company-growth';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  let seeded = 0;
  for (const seed of AUTOMATION_POLICY_SEEDS) {
    seeded += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase.from('automation_policies').upsert({
      ...seed,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'policy_key' });
    if (error?.message?.includes('automation_policies')) {
      console.log('[automation-governor] automation_policies missing - skipping persistence.');
      break;
    }
  }

  const pipelineRuns = await supabase
    .from('pipeline_steps')
    .select('step_key,status,error_message')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (pipelineRuns.error?.message?.includes('pipeline_steps')) {
    console.log(`[automation-governor] seeded=${seeded} failedSteps=0 dryRun=${DRY_RUN}`);
    return;
  }
  if (pipelineRuns.error) throw pipelineRuns.error;

  let retryJobs = 0;
  for (const row of (pipelineRuns.data ?? []) as Array<any>) {
    retryJobs += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase.from('pipeline_retry_jobs').upsert({
      step_key: row.step_key,
      run_context: 'auto_recovery',
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      next_retry_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      last_error: row.error_message ?? null,
      metadata: { source: 'automation-governor' },
    }, { onConflict: 'step_key,run_context' } as any);
    if (error?.message?.includes('pipeline_retry_jobs')) {
      console.log('[automation-governor] pipeline_retry_jobs missing - skipping retry queue persistence.');
      break;
    }
  }

  console.log(`[automation-governor] seeded=${seeded} retryJobs=${retryJobs} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
