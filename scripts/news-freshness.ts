import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  updated_at: string;
  published_at: string | null;
  storyline_id: string | null;
  last_verified_at: string | null;
};

async function queueSignal(page: PageRow, signalType: string, severity: number, detail: string, metadata: Record<string, unknown>) {
  await supabase.from('page_refresh_signals').upsert(
    {
      page_id: page.id,
      page_slug: page.slug,
      signal_type: signalType,
      severity,
      status: 'open',
      detail,
      metadata,
    },
    { onConflict: 'page_id,signal_type,status' },
  );
}

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,template,title,updated_at,published_at,storyline_id,last_verified_at')
    .eq('status', 'published')
    .in('template', ['news', 'trends'])
    .order('published_at', { ascending: false })
    .limit(250);

  if (error) throw error;

  let queued = 0;

  for (const page of (data ?? []) as PageRow[]) {
    const ageHours = (Date.now() - new Date(page.updated_at).getTime()) / (1000 * 60 * 60);

    if (page.storyline_id) {
      const { data: latestStory } = await supabase
        .from('storylines')
        .select('id,title,latest_event_at,update_count,freshness_score')
        .eq('id', page.storyline_id)
        .single();

      if (latestStory?.latest_event_at) {
        const latestEventTime = new Date(latestStory.latest_event_at).getTime();
        const pageUpdatedTime = new Date(page.updated_at).getTime();
        if (latestEventTime > pageUpdatedTime + 60 * 60 * 1000) {
          await queueSignal(
            page,
            'storyline_has_newer_event',
            88,
            `Storyline "${latestStory.title}" has a newer source event than the current page update.`,
            {
              storyline_id: latestStory.id,
              latest_event_at: latestStory.latest_event_at,
              update_count: latestStory.update_count,
            },
          );
          queued += 1;
        }
      }
    }

    if (ageHours > 72 && page.template === 'news') {
      await queueSignal(
        page,
        'news_verification_stale',
        72,
        'Published news page has not been re-verified in more than 72 hours.',
        {
          age_hours: Math.round(ageHours),
          last_verified_at: page.last_verified_at,
        },
      );
      queued += 1;
    }
  }

  console.log(`[news-freshness] queued or refreshed ${queued} freshness signal(s)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
