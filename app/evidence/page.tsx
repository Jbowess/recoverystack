import type { Metadata } from 'next';
import { latestSnapshotMap } from '@/lib/ai-reach';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Evidence Hub',
  description: 'Methodology, product truth, datasets, and discovery endpoints that support RecoveryStack recommendations and citations.',
};

async function getEvidenceData() {
  const [trustResult, truthResult, datasetResult, mentionResult, creatorResult] = await Promise.all([
    supabaseAdmin
      .from('editorial_trust_profiles')
      .select('slug,label,profile_type,evidence_requirements,review_steps,trust_signals')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(6),
    supabaseAdmin
      .from('product_truth_cards')
      .select('product_slug,card_type,title,body,priority')
      .eq('status', 'active')
      .order('priority', { ascending: false })
      .limit(12),
    supabaseAdmin
      .from('comparison_dataset_snapshots')
      .select('dataset_key,title,snapshot_date,row_count,metadata')
      .order('snapshot_date', { ascending: false })
      .limit(30),
    supabaseAdmin
      .from('community_topic_mentions')
      .select('title,source_platform,topic_slug,pain_points,captured_at')
      .order('captured_at', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from('creator_relationships')
      .select('slug,name,primary_platform,partnership_fit,relevance_score')
      .order('relevance_score', { ascending: false })
      .limit(8),
  ]);

  const datasets = [...latestSnapshotMap((datasetResult.data ?? []) as Array<{
    dataset_key: string;
    title: string;
    snapshot_date: string;
    row_count: number;
    metadata?: Record<string, unknown> | null;
  }>).values()].slice(0, 6);

  return {
    trustProfiles: trustResult.data ?? [],
    truthCards: truthResult.data ?? [],
    datasets,
    mentions: mentionResult.data ?? [],
    creators: creatorResult.data ?? [],
  };
}

export default async function EvidencePage() {
  const data = await getEvidenceData();

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <div className="rs-hero-grid">
            <div className="rs-hero-copy">
              <span className="rs-tag">Evidence Hub</span>
              <h1>Evidence surfaces built for both buyers and machines.</h1>
              <p className="rs-excerpt">
                This hub centralizes RecoveryStack methodology, product-truth cards, first-party datasets, and public discovery endpoints so assistants and human readers can verify what the brand stands for.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rs-main-section">
        <div className="rs-container rs-grid">
          <article className="rs-card">
            <h2>Methodology standards</h2>
            <ul>
              {data.trustProfiles.map((profile: any) => (
                <li key={profile.slug}>
                  <strong>{profile.label}</strong> ({profile.profile_type})
                  <div>{(profile.trust_signals ?? []).slice(0, 3).join(' · ')}</div>
                </li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>Product truth</h2>
            <ul>
              {data.truthCards.map((card: any) => (
                <li key={`${card.product_slug}-${card.card_type}-${card.title}`}>
                  <strong>{card.title}</strong>
                  <div>{card.body}</div>
                </li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>First-party datasets</h2>
            <ul>
              {data.datasets.map((dataset) => (
                <li key={dataset.dataset_key}>
                  <a href={`/research/${dataset.dataset_key}`}>{dataset.title}</a>
                  <div>
                    {dataset.snapshot_date} · {dataset.row_count} rows
                  </div>
                  {typeof dataset.metadata?.description === 'string' ? <div>{dataset.metadata.description}</div> : null}
                </li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>Off-site evidence signals</h2>
            <ul>
              {data.mentions.map((mention: any, index: number) => (
                <li key={`${mention.topic_slug}-${index}`}>
                  <strong>{mention.title ?? mention.topic_slug}</strong>
                  <div>{mention.source_platform} · {new Date(mention.captured_at).toLocaleDateString('en-AU')}</div>
                </li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>Creator and press graph</h2>
            <ul>
              {data.creators.map((creator: any) => (
                <li key={creator.slug}>
                  <strong>{creator.name}</strong>
                  <div>{creator.primary_platform} · relevance {creator.relevance_score}</div>
                  {creator.partnership_fit ? <div>{creator.partnership_fit}</div> : null}
                </li>
              ))}
            </ul>
          </article>

          <article className="rs-card">
            <h2>Machine discovery endpoints</h2>
            <ul>
              <li><a href="/llms.txt">/llms.txt</a></li>
              <li><a href="/api/merchant/product-feed">Merchant product feed</a></li>
              <li><a href="/api/assistant/catalog">Assistant catalog</a></li>
              <li><a href="/api/assistant/openapi">Assistant OpenAPI</a></li>
              <li><a href="/research">Research hub</a></li>
              <li><a href="/entities">Entity hub</a></li>
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
