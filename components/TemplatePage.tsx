import CompatibilityCheckerWidget from '@/components/CompatibilityCheckerWidget';
import ConversionBox from '@/components/ConversionBox';
import ExitIntentModal from '@/components/ExitIntentModal';
import NewsletterForm from '@/components/NewsletterForm';
import PillarLink from '@/components/PillarLink';
import ReadingProgressBar from '@/components/ReadingProgressBar';
import ShareBar from '@/components/ShareBar';
import TableOfContents from '@/components/TableOfContents';
import type { InternalLink, PageBodySection, PageRecord } from '@/lib/types';

type Props = {
  page: PageRecord;
  pillarLink: InternalLink | null;
  siblingLinks: InternalLink[];
  schemaJsonLd: unknown[];
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'Updated recently';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Updated recently';
  return new Intl.DateTimeFormat('en-AU', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function estimateReadTime(page: PageRecord) {
  const textParts: string[] = [page.h1, page.intro ?? ''];
  const sections = page.body_json?.sections ?? [];

  for (const section of sections) {
    textParts.push(section.heading);
    textParts.push(JSON.stringify(section.content));
  }

  const words = textParts.join(' ').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(3, Math.ceil(words / 220));
  return `${minutes} min read`;
}

function toSentenceArray(content: unknown): string[] {
  if (Array.isArray(content)) {
    return content.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean);
  }

  if (typeof content === 'string') {
    return [content];
  }

  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;

    if (Array.isArray(obj.paragraphs)) {
      return obj.paragraphs.map((item) => String(item));
    }

    if (Array.isArray(obj.items)) {
      return obj.items.map((item) => String(item));
    }

    if (Array.isArray(obj.studies)) {
      return obj.studies.map((item) => {
        const row = item as { title?: string; journal?: string | null; pubdate?: string | null };
        return [row.title, row.journal, row.pubdate].filter(Boolean).join(' — ');
      });
    }

    if (Array.isArray(obj.complaints)) {
      return obj.complaints.map((item) => {
        const row = item as { title?: string; subreddit?: string; score?: number | null; comments?: number | null };
        return `${row.title ?? 'Complaint'} (${row.subreddit ?? 'reddit'} · score ${row.score ?? 'n/a'} · comments ${row.comments ?? 'n/a'})`;
      });
    }

    return [JSON.stringify(content, null, 2)];
  }

  return [];
}

function renderSectionContent(section: PageBodySection) {
  const content = section.content as Record<string, unknown> | unknown;

  if (section.kind === 'faq') {
    const faqs = Array.isArray((content as Record<string, unknown>)?.items)
      ? ((content as Record<string, unknown>).items as Array<{ q?: string; a?: string }>)
      : [];

    if (faqs.length > 0) {
      return (
        <div>
          {faqs.map((faq, idx) => (
            <article key={`${section.id}-faq-${idx}`}>
              <h3>{faq.q ?? `Question ${idx + 1}`}</h3>
              <p>{faq.a ?? ''}</p>
            </article>
          ))}
        </div>
      );
    }
  }

  if (section.kind === 'steps' || section.kind === 'list') {
    const items = toSentenceArray(content);
    if (items.length) {
      return (
        <ol>
          {items.map((item, idx) => (
            <li key={`${section.id}-item-${idx}`}>{item}</li>
          ))}
        </ol>
      );
    }
  }

  if (section.kind === 'table') {
    const table = content as { headers?: string[]; rows?: string[][] };
    if (Array.isArray(table?.headers) && Array.isArray(table?.rows)) {
      return (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                {table.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, idx) => (
                <tr key={`${section.id}-row-${idx}`}>
                  {row.map((cell, cIdx) => (
                    <td key={`${section.id}-cell-${idx}-${cIdx}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }

  return toSentenceArray(content).map((paragraph, idx) => <p key={`${section.id}-p-${idx}`}>{paragraph}</p>);
}

function renderSections(page: PageRecord) {
  const sections = page.body_json?.sections ?? [];
  return sections.map((section) => (
    <section key={section.id} aria-labelledby={`section-${section.id}`}>
      <h2 id={`section-${section.id}`}>{section.heading}</h2>
      {renderSectionContent(section)}
    </section>
  ));
}

function buildTocItems(page: PageRecord): Array<{ id: string; text: string }> {
  const sections = page.body_json?.sections ?? [];
  const items = sections.map((s) => ({ id: `section-${s.id}`, text: s.heading }));
  if ((page.body_json?.verdict ?? []).length > 0) {
    items.push({ id: 'verdict-heading', text: 'RecoveryStack Verdict' });
  }
  return items;
}

export default function TemplatePage({ page, pillarLink, siblingLinks, schemaJsonLd }: Props) {
  const verdict = page.body_json?.verdict ?? [];
  const publishedDate = formatDate(page.published_at ?? page.updated_at);
  const readTime = estimateReadTime(page);
  const backTo = `/${page.template}`;
  const tocItems = buildTocItems(page);

  return (
    <div className="rs-shell">
      <ReadingProgressBar />

      <header className="rs-navbar" role="banner">
        <div className="rs-container rs-navbar-inner">
          <a href="/" className="rs-logo">RECOVERYSTACK</a>
          <nav aria-label="Primary" className="rs-nav-links">
            <a href="/guides">Guides</a>
            <a href="/alternatives">Alternatives</a>
            <a href="/protocols">Protocols</a>
            <a href="/metrics">Metrics</a>
            <a href="/costs">Costs</a>
            <a href="/trends">Trends</a>
          </nav>
        </div>
      </header>

      <section className="rs-hero">
        <div className="rs-container">
          <a className="rs-breadcrumb" href={backTo}>← All {page.template}</a>
          <div className="rs-hero-grid">
            <div className="rs-hero-copy">
              <span className="rs-tag">{page.template}</span>
              <h1>{page.h1}</h1>
              <p className="rs-meta">{publishedDate} · {readTime}</p>
              <p className="rs-excerpt">{page.intro ?? page.meta_description}</p>

              {/* Social proof / trust signals */}
              <div className="rs-trust-bar">
                <span className="rs-trust-item">Reviewed by RecoveryStack Editorial Team</span>
                <span className="rs-trust-divider" aria-hidden="true">·</span>
                <span className="rs-trust-item">Evidence-based</span>
                <span className="rs-trust-divider" aria-hidden="true">·</span>
                <span className="rs-trust-item">Last updated {publishedDate}</span>
              </div>

              <ShareBar title={page.title} />
            </div>
          </div>
        </div>
      </section>

      <main className="rs-main-section">
        <div className="rs-container rs-article-layout">
          {/* Sticky sidebar TOC on desktop */}
          <aside className="rs-toc-sidebar">
            <TableOfContents items={tocItems} />
          </aside>

          <div className="rs-article-column">
            <article className="rs-article rs-prose" aria-label="Article content">
              {renderSections(page)}

            {verdict.length > 0 ? (
              <section aria-labelledby="verdict-heading">
                <h2 id="verdict-heading"><span className="rs-gradient-text">RecoveryStack Verdict</span></h2>
                {verdict.slice(0, 3).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </section>
            ) : null}
          </article>

          <section className="rs-article rs-card" aria-labelledby="compatibility-heading">
            <h2 id="compatibility-heading">Compatibility checker</h2>
            <CompatibilityCheckerWidget pageSlug={page.slug} pageTemplate={page.template} />
          </section>

          <section className="rs-article rs-card" aria-labelledby="conversion-heading">
            <h2 id="conversion-heading">Next step</h2>
            <ConversionBox />
          </section>

          <section className="rs-related" aria-labelledby="related-heading">
            <div className="rs-article" style={{ maxWidth: '100%' }}>
              <h2 id="related-heading">Related articles</h2>
              <div className="rs-grid">
                {pillarLink ? (
                  <article className="rs-card">
                    <h3>Pillar guide</h3>
                    <PillarLink href={`/${pillarLink.template ?? 'pillars'}/${pillarLink.slug}`} anchorText={pillarLink.anchor} />
                  </article>
                ) : null}
                {siblingLinks.map((l) => {
                  const tmpl = l.template ?? page.template;
                  const label = tmpl.charAt(0).toUpperCase() + tmpl.slice(1);
                  return (
                    <article className="rs-card" key={l.slug}>
                      <h3>{label}</h3>
                      <PillarLink href={`/${tmpl}/${l.slug}`} anchorText={l.anchor} />
                    </article>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rs-article rs-card rs-newsletter" aria-labelledby="newsletter-heading">
            <h2 id="newsletter-heading">Get elite recovery intelligence weekly</h2>
            <p className="rs-excerpt">Evidence-backed protocols, device insights, and practical playbooks for performance-focused athletes.</p>
            <NewsletterForm pageTemplate={page.template} />
          </section>

          </div>{/* close rs-article-column */}
        </div>
      </main>

      <footer className="rs-footer">
        <div className="rs-container">
          <div className="rs-footer-grid">
            <div>
              <h3>Product</h3>
              <ul>
                <li><a href="/guides">Guides</a></li>
                <li><a href="/compatibility">Compatibility</a></li>
                <li><a href="/metrics">Metrics</a></li>
              </ul>
            </div>
            <div>
              <h3>Company</h3>
              <ul>
                <li><a href="/about">About</a></li>
                <li><a href="/trends">Research</a></li>
                <li><a href="/contact">Contact</a></li>
              </ul>
            </div>
            <div>
              <h3>Support</h3>
              <ul>
                <li><a href="/support">Help centre</a></li>
                <li><a href="/protocols">Protocols</a></li>
                <li><a href="/costs">Cost planning</a></li>
              </ul>
            </div>
            <div>
              <h3>Legal</h3>
              <ul>
                <li><a href="/privacy">Privacy</a></li>
                <li><a href="/terms">Terms</a></li>
                <li><a href="/cookies">Cookies</a></li>
              </ul>
            </div>
          </div>
          <p className="rs-tagline">Clinical-grade sleep intelligence for elite performers.</p>
        </div>
      </footer>

      {schemaJsonLd.map((item, idx) => (
        <script key={idx} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }} />
      ))}

      <ExitIntentModal pageTemplate={page.template} />
    </div>
  );
}
