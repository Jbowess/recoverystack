import { supabaseAdmin } from '@/lib/supabase-admin';

async function getPopularPages() {
  try {
    const { data } = await supabaseAdmin
      .from('pages')
      .select('slug,template,title,meta_description')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(6);
    return data ?? [];
  } catch {
    return [];
  }
}

const TEMPLATE_LABELS: Record<string, string> = {
  guides: 'Guide',
  alternatives: 'Alternative',
  protocols: 'Protocol',
  metrics: 'Metric',
  costs: 'Cost',
  compatibility: 'Compatibility',
  trends: 'Trend',
  pillars: 'Overview',
};

export default async function NotFound() {
  const popular = await getPopularPages();

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 16px 80px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <p style={{ fontSize: 80, lineHeight: 1, margin: '0 0 8px', color: '#d1d5db' }}>404</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>
          Page not found
        </h1>
        <p style={{ color: '#6b7280', maxWidth: 480, margin: '0 auto 24px' }}>
          The page you're looking for has moved, been updated, or never existed.
          Try one of our recent guides below, or head back to the homepage.
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 24px',
            background: '#111827',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Back to homepage
        </a>
      </div>

      {/* Popular articles */}
      {popular.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#374151', marginBottom: 20 }}>
            Popular articles
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {popular.map((page) => (
              <a
                key={page.slug}
                href={`/${page.template}/${page.slug}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: '16px',
                    height: '100%',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: '#6b7280',
                      marginBottom: 8,
                    }}
                  >
                    {TEMPLATE_LABELS[page.template] ?? page.template}
                  </span>
                  <p style={{ fontWeight: 600, color: '#111827', margin: '0 0 6px', fontSize: 14, lineHeight: 1.4 }}>
                    {page.title}
                  </p>
                  {page.meta_description && (
                    <p style={{ color: '#6b7280', fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                      {page.meta_description.slice(0, 100)}
                      {page.meta_description.length > 100 ? '…' : ''}
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Newsletter CTA */}
      <div
        style={{
          marginTop: 48,
          padding: '24px 28px',
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          textAlign: 'center',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontWeight: 700, color: '#111827' }}>
          Get the weekly recovery brief
        </h3>
        <p style={{ color: '#6b7280', margin: '0 0 16px', fontSize: 14 }}>
          Evidence-based recovery protocols, wearable comparisons, and performance insights — every week.
        </p>
        <a
          href="/#newsletter"
          style={{
            display: 'inline-block',
            padding: '9px 20px',
            background: '#16a34a',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Subscribe free
        </a>
      </div>
    </main>
  );
}
