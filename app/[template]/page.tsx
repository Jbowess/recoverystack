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
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '56px 16px 80px',
        fontFamily: 'system-ui, sans-serif',
        color: '#111827',
      }}
    >
      <section style={{ marginBottom: 36 }}>
        <p
          style={{
            margin: '0 0 10px',
            color: '#64748b',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          RecoveryStack topic hub
        </p>
        <h1 style={{ margin: '0 0 12px', fontSize: 36, lineHeight: 1.1 }}>{copy.title}</h1>
        <p style={{ margin: '0 0 20px', maxWidth: 760, color: '#475569', lineHeight: 1.7 }}>
          {copy.description} {copy.newsletterAngle}
        </p>
        <a
          href={NEWSLETTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '12px 22px',
            background: '#0f172a',
            color: '#fff',
            borderRadius: 9999,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Continue to RecoveryStack News
        </a>
      </section>

      {pages.length > 0 ? (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {pages.map((page) => (
            <a
              key={page.slug}
              href={`/${template}/${page.slug}`}
              style={{
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '18px 18px 20px',
                background: '#fff',
              }}
            >
              <p
                style={{
                  margin: '0 0 10px',
                  color: '#16a34a',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                }}
              >
                {copy.title}
              </p>
              <h2 style={{ margin: '0 0 10px', fontSize: 17, lineHeight: 1.35 }}>{page.title}</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
                {(page.meta_description ?? '').slice(0, 140)}
                {(page.meta_description ?? '').length > 140 ? '...' : ''}
              </p>
            </a>
          ))}
        </section>
      ) : (
        <section
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '24px',
            background: '#fff',
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>No published pages yet</h2>
          <p style={{ margin: 0, color: '#64748b', lineHeight: 1.6 }}>
            This topic hub is ready, but there are no published pages in this cluster yet.
          </p>
        </section>
      )}
    </main>
  );
}
