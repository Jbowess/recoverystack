import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Our Team — Sports Science & Recovery Technology Experts | RecoveryStack',
  description: 'Meet the sports scientists, recovery technology analysts, and performance researchers behind RecoveryStack.',
};

interface Author {
  id: string;
  slug: string;
  name: string;
  title: string;
  bio: string | null;
  credentials: string[] | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  avatar_url: string | null;
}

export default async function TeamPage() {
  const { data: authors } = await supabase
    .from('authors')
    .select('*')
    .order('name', { ascending: true });

  const team = (authors ?? []) as Author[];

  return (
    <div className="rs-shell">
      <header className="rs-navbar" role="banner">
        <div className="rs-container rs-navbar-inner">
          <a href="/" className="rs-logo">RECOVERYSTACK</a>
          <nav aria-label="Primary" className="rs-nav-links">
            <a href="/guides">Guides</a>
            <a href="/alternatives">Alternatives</a>
            <a href="/protocols">Protocols</a>
          </nav>
        </div>
      </header>

      <main className="rs-main-section">
        <div className="rs-container" style={{ maxWidth: '1000px', margin: '0 auto', padding: '3rem 1rem' }}>
          <a href="/about" className="rs-breadcrumb">← About RecoveryStack</a>

          <h1 style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>Our Team</h1>
          <p className="rs-excerpt" style={{ marginBottom: '3rem' }}>
            RecoveryStack content is produced by sports scientists, recovery technology analysts, and performance researchers. Every article is evidence-based and independently tested.
          </p>

          {team.length === 0 ? (
            <p>Team profiles coming soon.</p>
          ) : (
            <div className="rs-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {team.map((author) => (
                <a
                  key={author.slug}
                  href={`/authors/${author.slug}`}
                  className="rs-card"
                  style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', padding: '1.5rem' }}
                >
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                    {author.avatar_url ? (
                      <img
                        src={author.avatar_url}
                        alt={author.name}
                        width={64}
                        height={64}
                        style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: '50%',
                          background: 'var(--rs-surface-2, #1e293b)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.5rem',
                          flexShrink: 0,
                        }}
                      >
                        {author.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <h2 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>{author.name}</h2>
                      <p style={{ fontSize: '0.85rem', color: 'var(--rs-muted, #94a3b8)', margin: 0 }}>{author.title}</p>
                    </div>
                  </div>

                  {author.bio && (
                    <p style={{ fontSize: '0.9rem', color: 'var(--rs-muted, #94a3b8)', lineHeight: 1.6, margin: 0 }}>
                      {author.bio.slice(0, 120)}{author.bio.length > 120 ? '…' : ''}
                    </p>
                  )}

                  {author.credentials && author.credentials.length > 0 && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {author.credentials.slice(0, 2).map((cred, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '999px',
                            background: 'var(--rs-surface-2, #1e293b)',
                            color: 'var(--rs-accent, #00c2a8)',
                          }}
                        >
                          {cred}
                        </span>
                      ))}
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="rs-footer">
        <div className="rs-container">
          <p className="rs-tagline">Organic recovery-tech content that feeds RecoveryStack News and the Volo Ring funnel.</p>
        </div>
      </footer>
    </div>
  );
}
