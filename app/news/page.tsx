import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { NEWSLETTER_URL } from '@/lib/brand';

export const revalidate = 900;

const SITE = process.env.SITE_URL ?? 'https://recoverystack.io';

const BEAT_LABELS: Record<string, string> = {
  wearables: 'Wearables',
  sleep_tech: 'Sleep Tech',
  sleep_science: 'Sleep Science',
  recovery_protocols: 'Recovery',
  nutrition: 'Nutrition',
  regulatory: 'Regulatory',
  performance: 'Performance',
  general_recovery: 'Recovery',
};

const FORMAT_LABELS: Record<string, string> = {
  breaking: 'Breaking',
  research: 'Research',
  roundup: 'Roundup',
  expert_reaction: 'Expert',
  data_brief: 'Data',
};

export const metadata: Metadata = {
  title: 'Recovery & Fitness Tech News | RecoveryStack',
  description: 'Breaking news, research briefs, and expert commentary on wearables, sleep technology, HRV, and recovery science. Updated daily.',
  alternates: {
    canonical: `${SITE}/news`,
    types: {
      'application/rss+xml': `${SITE}/api/news-rss`,
    },
  },
  openGraph: {
    type: 'website',
    url: `${SITE}/news`,
    title: 'Recovery & Fitness Tech News | RecoveryStack',
    description: 'Breaking news, research briefs, and expert commentary on wearables, sleep technology, HRV, and recovery science.',
    siteName: 'RecoveryStack',
  },
};

type NewsPage = {
  slug: string;
  title: string;
  meta_description: string | null;
  published_at: string | null;
  beat: string | null;
  news_format: string | null;
};

async function getNewsPages(beat?: string) {
  let query = supabaseAdmin
    .from('pages')
    .select('slug, title, meta_description, published_at, beat, news_format')
    .eq('status', 'published')
    .eq('template', 'news')
    .order('published_at', { ascending: false })
    .limit(48);

  if (beat) {
    query = query.eq('beat', beat);
  }

  const { data } = await query;
  return (data ?? []) as NewsPage[];
}

async function getAvailableBeats(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('pages')
    .select('beat')
    .eq('status', 'published')
    .eq('template', 'news')
    .not('beat', 'is', null);

  const beats = new Set<string>();
  for (const row of data ?? []) {
    if (row.beat) beats.add(row.beat);
  }
  return Array.from(beats).sort();
}

export default async function NewsIndexPage() {
  const [pages, beats] = await Promise.all([getNewsPages(), getAvailableBeats()]);

  const newsJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Recovery & Fitness Tech News',
    description: 'Breaking news, research briefs, and expert commentary on wearables, sleep technology, and recovery science.',
    url: `${SITE}/news`,
    publisher: {
      '@type': 'Organization',
      name: 'RecoveryStack',
      url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/logo.png` },
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(newsJsonLd) }} />

      <div className="rs-shell">
        <header className="rs-navbar" role="banner">
          <div className="rs-container rs-navbar-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href="/" className="rs-logo" aria-label="RecoveryStack home"><img src="/logo.png" alt="RecoveryStack" height={32} style={{ display: 'block', height: '32px', width: 'auto' }} /></a>
            <nav aria-label="Primary" className="rs-nav-links">
              <a href="/news" aria-current="page">News</a>
              <a href="/guides">Guides</a>
              <a href="/alternatives">Alternatives</a>
              <a href="/protocols">Protocols</a>
            </nav>
          </div>
        </header>

        <main className="rs-main-section" id="main-content">
          <div className="rs-container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1rem' }}>

            {/* Page header */}
            <div style={{ marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--rs-muted, #94a3b8)', marginBottom: '0.5rem' }}>
                RecoveryStack News
              </p>
              <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 700, marginBottom: '0.75rem' }}>
                Recovery &amp; Fitness Tech News
              </h1>
              <p style={{ color: 'var(--rs-muted, #94a3b8)', maxWidth: '640px', lineHeight: 1.6 }}>
                Breaking news, research briefs, and expert commentary on wearables, sleep science, HRV, and recovery technology — updated daily.
              </p>
            </div>

            {/* Beat filter nav */}
            {beats.length > 0 && (
              <nav aria-label="News topics" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
                <a
                  href="/news"
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '999px',
                    fontSize: '0.8rem',
                    background: 'var(--rs-accent, #3b82f6)',
                    color: '#fff',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  All
                </a>
                {beats.map((beat) => (
                  <a
                    key={beat}
                    href={`/news/beat/${beat}`}
                    style={{
                      padding: '0.3rem 0.75rem',
                      borderRadius: '999px',
                      fontSize: '0.8rem',
                      background: 'var(--rs-surface-2, #1e293b)',
                      color: 'var(--rs-muted, #94a3b8)',
                      textDecoration: 'none',
                    }}
                  >
                    {BEAT_LABELS[beat] ?? beat}
                  </a>
                ))}
              </nav>
            )}

            {/* News grid */}
            {pages.length > 0 ? (
              <section aria-label="Latest news">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
                  {pages.map((page) => {
                    const date = page.published_at ? new Date(page.published_at) : null;
                    const beatLabel = page.beat ? (BEAT_LABELS[page.beat] ?? page.beat) : null;
                    const formatLabel = page.news_format ? FORMAT_LABELS[page.news_format] : null;

                    return (
                      <article
                        key={page.slug}
                        className="rs-card"
                        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1.25rem' }}
                      >
                        {/* Beat + format badges */}
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {formatLabel && (
                            <span style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                              color: 'var(--rs-accent, #3b82f6)',
                            }}>
                              {formatLabel}
                            </span>
                          )}
                          {beatLabel && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--rs-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {beatLabel}
                            </span>
                          )}
                        </div>

                        <a href={`/news/${page.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <h2 style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
                            {page.title}
                          </h2>
                        </a>

                        {page.meta_description && (
                          <p style={{ fontSize: '0.85rem', color: 'var(--rs-muted, #94a3b8)', lineHeight: 1.5, margin: 0 }}>
                            {page.meta_description.slice(0, 120)}{page.meta_description.length > 120 ? '…' : ''}
                          </p>
                        )}

                        {date && (
                          <time
                            dateTime={date.toISOString()}
                            style={{ fontSize: '0.75rem', color: 'var(--rs-muted, #94a3b8)', marginTop: 'auto', paddingTop: '0.5rem' }}
                          >
                            {date.toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </time>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="rs-card" style={{ padding: '2rem', textAlign: 'center' }}>
                <h2 style={{ marginBottom: '0.5rem' }}>First news articles coming soon</h2>
                <p style={{ color: 'var(--rs-muted, #94a3b8)' }}>
                  Subscribe to the newsletter to get daily recovery tech news before it's on the site.
                </p>
                <a href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer" className="rs-btn" style={{ marginTop: '1rem', display: 'inline-block' }}>
                  Subscribe to RecoveryStack News
                </a>
              </div>
            )}

            {/* Newsletter CTA */}
            <aside style={{ marginTop: '3rem', padding: '1.5rem', background: 'var(--rs-surface-2, #1e293b)', borderRadius: '12px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.4rem' }}>Get the daily brief</h2>
              <p style={{ color: 'var(--rs-muted, #94a3b8)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                RecoveryStack News lands in your inbox every morning — the signal, not the noise. $1/mo, cancel anytime.
              </p>
              <a href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer" className="rs-btn rs-btn-primary">
                Start reading for $1/mo
              </a>
            </aside>

          </div>
        </main>

        <footer className="rs-footer">
          <div className="rs-container">
            <nav aria-label="Footer">
              <a href="/news">News</a>
              <a href="/guides">Guides</a>
              <a href="/protocols">Protocols</a>
              <a href="/api/news-rss" type="application/rss+xml">RSS</a>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}
