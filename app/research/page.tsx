import type { Metadata } from 'next';
import { latestSnapshotMap } from '@/lib/ai-reach';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Research Hub',
  description: 'Latest RecoveryStack comparison datasets and first-party research snapshots for wearables and smart ring buyers.',
};

export default async function ResearchIndexPage() {
  const { data, error } = await supabaseAdmin
    .from('comparison_dataset_snapshots')
    .select('dataset_key,title,snapshot_date,row_count,metadata')
    .order('snapshot_date', { ascending: false })
    .limit(40);

  if (error) throw error;

  const datasets = [...latestSnapshotMap((data ?? []) as Array<{
    dataset_key: string;
    title: string;
    snapshot_date: string;
    row_count: number;
    metadata?: Record<string, unknown> | null;
  }>).values()];

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <span className="rs-tag">Research Hub</span>
          <h1>First-party comparison data that powers commercial pages.</h1>
          <p className="rs-excerpt">
            These datasets feed price comparisons, subscription analysis, platform-fit tooling, and evidence blocks across RecoveryStack.
          </p>
        </div>
      </section>

      <section className="rs-main-section">
        <div className="rs-container seo-grid-3">
          {datasets.map((dataset) => (
            <article className="rs-card" key={dataset.dataset_key}>
              <h2 style={{ marginTop: 0 }}>
                <a href={`/research/${dataset.dataset_key}`}>{dataset.title}</a>
              </h2>
              <p>{typeof dataset.metadata?.description === 'string' ? dataset.metadata.description : 'RecoveryStack research snapshot.'}</p>
              <p style={{ color: 'var(--rs-muted, #94a3b8)' }}>
                Snapshot: {new Date(dataset.snapshot_date).toLocaleDateString('en-AU')} · Rows: {dataset.row_count}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
