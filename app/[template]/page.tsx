import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NEWSLETTER_URL } from '@/lib/brand';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { TemplateType } from '@/lib/types';

const ALLOWED_TEMPLATES: TemplateType[] = [
  'guides',
  'alternatives',
  'protocols',
  'metrics',
  'costs',
  'compatibility',
  'trends',
  'pillars',
  'reviews',
  'checklists',
];

const TEMPLATE_COPY: Record<
  TemplateType,
  { title: string; description: string; newsletterAngle: string }
> = {
  guides: {
    title: 'Recovery Guides',
    description: 'Long-form recovery explainers designed to capture high-intent search traffic.',
    newsletterAngle: 'Get the distilled version in RecoveryStack News.',
  },
  alternatives: {
    title: 'Alternatives',
    description: 'Comparison content for buyers choosing between recovery tools and wearable options.',
    newsletterAngle: 'Use the newsletter to stay current before you buy.',
  },
  protocols: {
    title: 'Protocols',
    description: 'Evidence-based recovery workflows and practical implementation guides.',
    newsletterAngle: 'RecoveryStack News turns protocols into an ongoing operating system.',
  },
  metrics: {
    title: 'Metrics',
    description: 'Pages that explain the signals behind recovery scores, sleep data, and training feedback.',
    newsletterAngle: 'Get the interpretation layer in the newsletter.',
  },
  costs: {
    title: 'Costs',
    description: 'Commercial-intent content around value, total cost, and buying tradeoffs.',
    newsletterAngle: 'The newsletter is where cost context turns into buying confidence.',
  },
  compatibility: {
    title: 'Compatibility',
    description: 'Decision-support content for readers checking if products fit their stack and habits.',
    newsletterAngle: 'RecoveryStack News keeps the stack-level view current.',
  },
  trends: {
    title: 'Trends',
    description: 'News-style pages around recovery-tech movements, launches, and search demand shifts.',
    newsletterAngle: 'Follow RecoveryStack News for the weekly trend brief.',
  },
  pillars: {
    title: 'Pillars',
    description: 'Core overview pages that map the brand’s main recovery topics and search clusters.',
    newsletterAngle: 'Use the newsletter as the ongoing layer after the pillar read.',
  },
  reviews: {
    title: 'Reviews',
    description: 'Review pages that evaluate recovery products, tools, and brand positioning.',
    newsletterAngle: 'Use RecoveryStack News to keep tracking the category after the review.',
  },
  checklists: {
    title: 'Checklists',
    description: 'Checklist content built for practical action and repeatable recovery decisions.',
    newsletterAngle: 'The newsletter keeps the checklist current as the market changes.',
  },
};

function isTemplate(value: string): value is TemplateType {
  return ALLOWED_TEMPLATES.includes(value as TemplateType);
}

async function getPages(template: TemplateType) {
  const { data } = await supabaseAdmin
    .from('pages')
    .select('slug,title,meta_description,published_at')
    .eq('status', 'published')
    .eq('template', template)
    .order('published_at', { ascending: false })
    .limit(24);

  return data ?? [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ template: string }>;
}): Promise<Metadata> {
  const { template } = await params;
  if (!isTemplate(template)) return {};

  const copy = TEMPLATE_COPY[template];
  return {
    title: copy.title,
    description: `${copy.description} ${copy.newsletterAngle}`,
  };
}

export default async function TemplateIndexPage({
  params,
}: {
  params: Promise<{ template: string }>;
}) {
  const { template } = await params;
  if (!isTemplate(template)) notFound();

  const copy = TEMPLATE_COPY[template];
  const pages = await getPages(template);

  return (
    <main className="seo-shell seo-page">
      <section className="seo-section">
        <div className="seo-container">
          <div className="glass-card" style={{ borderRadius: 28, padding: 32 }}>
            <p className="section-label">RecoveryStack Topic Hub</p>
            <h1 className="headline-display is-compact">{copy.title}</h1>
            <p className="seo-body-copy" style={{ marginTop: 18, maxWidth: 760 }}>
              {copy.description} {copy.newsletterAngle}
            </p>
            <div className="seo-actions">
              <a
                className="btn-primary"
                href={NEWSLETTER_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue to RecoveryStack News
              </a>
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            {pages.length > 0 ? (
              <section className="seo-grid-3" aria-label={`${copy.title} pages`}>
                {pages.map((page) => (
                  <a
                    key={page.slug}
                    href={`/${template}/${page.slug}`}
                    className="glass-card seo-article-card sensor-glow"
                  >
                    <span className="seo-eyebrow">{copy.title}</span>
                    <h3>{page.title}</h3>
                    <p>
                      {(page.meta_description ?? '').slice(0, 150)}
                      {(page.meta_description ?? '').length > 150 ? '...' : ''}
                    </p>
                  </a>
                ))}
              </section>
            ) : (
              <section className="glass-card seo-card" aria-live="polite">
                <h3>No published pages yet</h3>
                <p>
                  This topic hub is ready, but there are no published pages in this cluster yet.
                </p>
              </section>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
