import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CHECKPOINTS = [6, 24, 72, 168];

type PublishedPage = {
  id: string;
  slug: string;
  title: string;
  storyline_id: string | null;
  updated_at: string;
  published_at: string | null;
};

async function scheduleJobs(page: PublishedPage) {
  const publishedAt = new Date(page.published_at ?? page.updated_at);
  for (const checkpoint of CHECKPOINTS) {
    const scheduledFor = new Date(publishedAt.getTime() + checkpoint * 60 * 60 * 1000).toISOString();
    await supabase.from('story_followup_jobs').upsert(
      {
        page_id: page.id,
        storyline_id: page.storyline_id,
        page_slug: page.slug,
        checkpoint_hours: checkpoint,
        scheduled_for: scheduledFor,
        status: 'scheduled',
        metadata: { title: page.title },
      },
      { onConflict: 'page_id,checkpoint_hours' },
    );
  }
}

async function queueRefreshSignal(page: PublishedPage, checkpoint: number, latestEventAt: string | null) {
  await supabase.from('page_refresh_signals').upsert(
    {
      page_id: page.id,
      page_slug: page.slug,
      signal_type: 'story_followup_due',
      severity: checkpoint >= 72 ? 82 : 70,
      status: 'open',
      detail: `Story follow-up checkpoint ${checkpoint}h detected a newer storyline event.`,
      metadata: {
        checkpoint_hours: checkpoint,
        latest_event_at: latestEventAt,
      },
    },
    { onConflict: 'page_id,signal_type,status' },
  );

  await supabase.from('content_refresh_queue').upsert(
    {
      page_id: page.id,
      slug: page.slug,
      reason: `story_followup_${checkpoint}h`,
      status: 'queued',
    } as any,
    { onConflict: 'page_id' },
  );
}

async function runDueJobs() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('story_followup_jobs')
    .select('id,page_id,page_slug,storyline_id,checkpoint_hours,scheduled_for,status')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(100);

  if (error) throw error;

  let processed = 0;
  for (const job of data ?? []) {
    const [{ data: page }, { data: storyline }] = await Promise.all([
      supabase.from('pages').select('id,slug,title,storyline_id,updated_at,published_at').eq('id', job.page_id).single(),
      job.storyline_id
        ? supabase.from('storylines').select('id,latest_event_at,update_count').eq('id', job.storyline_id).single()
        : Promise.resolve({ data: null, error: null } as any),
    ]);

    if (page && storyline?.latest_event_at) {
      const latestEventAt = new Date(storyline.latest_event_at).getTime();
      const pageUpdatedAt = new Date(page.updated_at).getTime();
      if (latestEventAt > pageUpdatedAt) {
        await queueRefreshSignal(page as PublishedPage, Number(job.checkpoint_hours), storyline.latest_event_at);
      }
    }

    await supabase
      .from('story_followup_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    processed += 1;
  }

  return processed;
}

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,title,storyline_id,updated_at,published_at')
    .eq('status', 'published')
    .eq('template', 'news')
    .not('published_at', 'is', null)
    .limit(250);

  if (error) throw error;

  for (const page of (data ?? []) as PublishedPage[]) {
    await scheduleJobs(page);
  }

  const processed = await runDueJobs();
  console.log(`[story-followup] scheduled=${(data ?? []).length * CHECKPOINTS.length} processed=${processed}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
