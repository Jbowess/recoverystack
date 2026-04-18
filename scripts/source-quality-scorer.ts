import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type SourceEvent = {
  id?: string;
  source_domain: string | null;
  beat: string;
  status: string;
};

function clampScore(value: number) {
  return Math.max(1, Math.min(100, Math.round(value)));
}

async function run() {
  const [eventsResult, referencesResult, pagesResult] = await Promise.all([
    supabase.from('news_source_events').select('id,source_domain,beat,status').limit(5000),
    supabase.from('page_source_references').select('source_domain').limit(5000),
    supabase.from('pages').select('source_event_id').not('source_event_id', 'is', null).limit(3000),
  ]);

  if (eventsResult.error) throw eventsResult.error;
  if (referencesResult.error) throw referencesResult.error;
  if (pagesResult.error) throw pagesResult.error;

  const citationsByDomain = new Map<string, number>();
  for (const ref of referencesResult.data ?? []) {
    const key = String(ref.source_domain ?? '').trim();
    if (!key) continue;
    citationsByDomain.set(key, (citationsByDomain.get(key) ?? 0) + 1);
  }

  const pageEventIds = new Set((pagesResult.data ?? []).map((row: any) => String(row.source_event_id)));
  const aggregates = new Map<string, { beat: string; event_count: number; coverage_count: number; ready_count: number }>();

  for (const event of (eventsResult.data ?? []) as SourceEvent[]) {
    const key = String(event.source_domain ?? '').trim();
    if (!key) continue;
    const current = aggregates.get(key) ?? { beat: event.beat, event_count: 0, coverage_count: 0, ready_count: 0 };
    current.event_count += 1;
    if (event.status === 'ready' || event.status === 'clustered') current.ready_count += 1;
    if (event.id && pageEventIds.has(String(event.id))) current.coverage_count += 1;
    aggregates.set(key, current);
  }

  const rows = [...aggregates.entries()].map(([sourceKey, aggregate]) => {
    const citationCount = citationsByDomain.get(sourceKey) ?? 0;
    const successRate = aggregate.event_count > 0 ? aggregate.ready_count / aggregate.event_count : 0;
    const score = clampScore(
      successRate * 45 +
      Math.min(25, Math.log10(aggregate.event_count + 1) * 12) +
      Math.min(20, citationCount * 2),
    );

    return {
      source_key: sourceKey,
      source_kind: 'domain',
      beat: aggregate.beat,
      score,
      event_count: aggregate.event_count,
      citation_count: citationCount,
      page_count: aggregate.coverage_count,
      coverage_count: aggregate.coverage_count,
      success_rate: Number(successRate.toFixed(4)),
      metadata: {
        ready_rate: successRate,
      },
      last_computed_at: new Date().toISOString(),
    };
  });

  if (rows.length) {
    const { error } = await supabase.from('source_quality_scores').upsert(rows, { onConflict: 'source_key' });
    if (error) throw error;
  }

  console.log(`[source-quality-scorer] scored ${rows.length} sources`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
