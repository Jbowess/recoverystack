import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_NAME } from '@/lib/brand';

type BrandSeoPreviewProps = {
  brand: string;
  category: string;
  heroTitle: string;
  heroBody: string;
  proofItems: Array<{ title: string; text: string }>;
  benefits: Array<{ title: string; text: string; bullets: string[] }>;
  comparisonRows: Array<{ label: string; brand: string; generic: string }>;
  faqs: Array<{ q: string; a: string }>;
};

function SectionHeading({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{ maxWidth: 760, marginBottom: 28 }}>
      <p className="section-label">{label}</p>
      <h2 className="headline-display is-compact">{title}</h2>
      <p className="seo-body-copy" style={{ marginTop: 18 }}>{body}</p>
    </div>
  );
}

export default function BrandSeoPreview({
  brand,
  category,
  heroTitle,
  heroBody,
  proofItems,
  benefits,
  comparisonRows,
  faqs,
}: BrandSeoPreviewProps) {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <main className="seo-shell seo-page">
        <header className="seo-nav" role="banner">
          <div className="seo-container seo-nav-inner">
            <a href="/" className="seo-nav-brand">RecoveryStack</a>
            <nav aria-label="Primary" className="seo-nav-links">
              <a href="#proof">Proof</a>
              <a href="#benefits">Benefits</a>
              <a href="#comparison">Comparison</a>
              <a href="#faq">FAQ</a>
            </nav>
            <a className="btn-primary" href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer">
              Read RecoveryStack News
            </a>
          </div>
        </header>

        <section className="seo-hero">
          <div className="seo-container">
            <div className="seo-hero-grid">
              <div className="seo-hero-copy">
                <p className="section-label">{category}</p>
                <h1 className="headline-display">
                  {heroTitle}
                  <br />
                  <span className="text-gradient">{brand}</span>
                </h1>
                <p className="seo-body-copy" style={{ marginTop: 22 }}>{heroBody}</p>

                <div className="seo-actions">
                  <a className="btn-primary" href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer">
                    See RecoveryStack News
                  </a>
                  <a className="btn-outline" href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">
                    Visit Main Site
                  </a>
                </div>

                <div className="seo-inline-metrics">
                  <div className="seo-inline-metric">
                    <strong>{brand}</strong>
                    <span>Target brand</span>
                  </div>
                  <div className="seo-inline-metric">
                    <strong>SEO</strong>
                    <span>Commercial intent page</span>
                  </div>
                  <div className="seo-inline-metric">
                    <strong>{PRODUCT_NAME}</strong>
                    <span>Down-funnel product path</span>
                  </div>
                </div>
              </div>

              <aside className="glass-card seo-kicker-card sensor-glow">
                <h2>Preview Surface</h2>
                <p style={{ marginTop: 14 }}>
                  This is a sample branded landing page in the RecoveryStack clinical-tech system,
                  intended to show what a generated brand page would look like on localhost.
                </p>
                <div className="seo-chip-row">
                  <span className="seo-chip">Glass Surface</span>
                  <span className="seo-chip">Uppercase Display</span>
                  <span className="seo-chip">Controlled Cyan Accent</span>
                </div>
                <div className="seo-proof-strip">
                  {proofItems.map((item) => (
                    <div key={item.title} className="seo-proof-cell hairline-frame">
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section id="proof" className="seo-section seo-section-tight">
          <div className="seo-container">
            <SectionHeading
              label="Trust / Proof"
              title={`Why ${brand} pages need stronger brand framing`}
              body={`This preview keeps ${brand} inside the same high-trust RecoveryStack product family. The page stays SEO-aware, but the interface feels like a premium recovery-tech system instead of a generic content template.`}
            />

            <div className="seo-grid-3">
              {proofItems.map((item) => (
                <article key={item.title} className="glass-card seo-card sensor-glow">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="benefits" className="seo-section">
          <div className="seo-container">
            <SectionHeading
              label="Brand Benefits"
              title={`What this ${brand} landing page is doing`}
              body={`The layout is tuned for comparison-heavy recovery search intent. It creates product trust, frames the category, and gives RecoveryStack a cleaner route into newsletter and product conversion.`}
            />

            <div className="seo-grid-3">
              {benefits.map((item) => (
                <article key={item.title} className="glass-card seo-list-card sensor-glow">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <ul>
                    {item.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="comparison" className="seo-section seo-dark-section">
          <div className="seo-container">
            <SectionHeading
              label="Why Choose RecoveryStack"
              title={`${brand} search intent, presented with precision`}
              body={`A branded RecoveryStack page should look like it belongs to a premium biotech / performance lab system. This comparison shows the gap between that approach and default SEO layouts.`}
            />

            <div className="seo-comparison">
              <div className="glass-card sensor-glow" style={{ borderRadius: 24, padding: 28 }}>
                <table className="seo-comparison-table" aria-label={`${brand} comparison table`}>
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>RecoveryStack Page</th>
                      <th>Generic SEO Page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((row) => (
                      <tr key={row.label}>
                        <td><strong>{row.label}</strong></td>
                        <td>{row.brand}</td>
                        <td>{row.generic}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <aside className="glass-card-dark seo-card sensor-glow" style={{ borderRadius: 24, padding: 28 }}>
                <h3 className="seo-panel-title">Conversion Outcome</h3>
                <p className="seo-meta-text" style={{ marginTop: 16 }}>
                  The goal is not just ranking. It is moving a reader who searched for {brand} into
                  a more trusted RecoveryStack environment, then handing that user into the main
                  newsletter and product path.
                </p>
              </aside>
            </div>
          </div>
        </section>

        <section id="faq" className="seo-section">
          <div className="seo-container">
            <SectionHeading
              label="FAQ"
              title={`Questions a ${brand} buyer would still ask`}
              body="The FAQ keeps commercial objections and SEO follow-up queries inside the same polished page shell, instead of dropping the user into weak support-style formatting."
            />

            <div className="seo-faq-list">
              {faqs.map((faq) => (
                <details key={faq.q} className="glass-card seo-faq-item sensor-glow">
                  <summary>{faq.q}</summary>
                  <p className="seo-faq-answer">{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="seo-section">
          <div className="seo-container">
            <div className="glass-card-dark seo-cta-band sensor-glow">
              <p className="section-label">Final CTA</p>
              <h2 className="headline-display is-compact">
                See the branded page
                <br />
                working in context
              </h2>
              <p className="seo-body-copy" style={{ marginTop: 18 }}>
                If this direction is right, I can turn it into a repeatable generator for more brands
                and wire it into the rest of the RecoveryStack publishing flow.
              </p>
              <div className="seo-dual-actions">
                <a className="btn-primary" href={NEWSLETTER_URL} target="_blank" rel="noopener noreferrer">
                  Read RecoveryStack News
                </a>
                <a className="btn-outline" href={MAIN_SITE_URL} target="_blank" rel="noopener noreferrer">
                  Open RecoveryStack.io
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
