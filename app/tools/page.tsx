import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tools',
  description: 'RecoveryStack buyer and comparison tools built for search visitors and assistant discovery.',
};

export default async function ToolsIndexPage() {
  const { data } = await supabaseAdmin
    .from('tool_idea_queue')
    .select('title,idea_type,status,page_slug')
    .order('priority', { ascending: false })
    .limit(6);

  return (
    <main className="rs-shell">
      <section className="rs-hero">
        <div className="rs-container">
          <span className="rs-tag">Tool Hub</span>
          <h1>Interactive buyer utilities, not just articles.</h1>
          <p className="rs-excerpt">
            These tools turn pricing, compatibility, and fit questions into usable decision surfaces that can also back assistant workflows.
          </p>
        </div>
      </section>

      <section className="rs-main-section">
        <div className="rs-container seo-grid-3">
          <article className="rs-card">
            <h2 style={{ marginTop: 0 }}><a href="/tools/smart-ring-fit">Smart Ring Fit Tool</a></h2>
            <p>Route buyers into the right segment, lead magnet, and product angle.</p>
          </article>
          <article className="rs-card">
            <h2 style={{ marginTop: 0 }}><a href="/tools/subscription-cost-calculator">Subscription Cost Calculator</a></h2>
            <p>Model year-one and multi-year wearable cost instead of comparing sticker price only.</p>
          </article>
          <article className="rs-card">
            <h2 style={{ marginTop: 0 }}><a href="/tools/platform-compatibility">Platform Compatibility Explorer</a></h2>
            <p>Filter products by phone platform, battery expectations, and subscription tolerance.</p>
          </article>
        </div>

        <div className="rs-container" style={{ marginTop: 24 }}>
          <article className="rs-card">
            <h2>Queued tool ideas</h2>
            {data?.length ? (
              <ul>
                {data.map((tool: any, index: number) => (
                  <li key={`${tool.page_slug}-${tool.idea_type}-${index}`}>
                    <strong>{tool.title}</strong> ({tool.idea_type}) · {tool.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No queued ideas yet.</p>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
