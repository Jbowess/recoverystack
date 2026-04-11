import { ImageResponse } from 'next/og';
import { getPageByTemplateAndSlug } from '@/lib/supabase';
import type { TemplateType } from '@/lib/types';

export const runtime = 'edge';
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

const templates: TemplateType[] = [
  'guides',
  'alternatives',
  'protocols',
  'metrics',
  'costs',
  'compatibility',
  'trends',
  'pillars',
];

function isTemplateType(value: string): value is TemplateType {
  return templates.includes(value as TemplateType);
}

export default async function Image({
  params,
}: {
  params: Promise<{ template: string; slug: string }>;
}) {
  const { template, slug } = await params;

  const fallbackTitle = `RecoveryStack · ${template}`;
  const fallbackDescription = slug.replace(/-/g, ' ');

  let title = fallbackTitle;
  let description = fallbackDescription;

  if (isTemplateType(template)) {
    const page = await getPageByTemplateAndSlug(template, slug);

    if (page) {
      title = page.h1 || page.title || fallbackTitle;
      description = page.meta_description || page.primary_keyword || fallbackDescription;
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #2563eb 100%)',
          color: '#f8fafc',
          fontFamily: 'Inter, Arial, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            fontWeight: 700,
            opacity: 0.9,
          }}
        >
          RecoveryStack.io
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 58, lineHeight: 1.1, fontWeight: 800 }}>{title}</div>
          <div style={{ fontSize: 28, lineHeight: 1.3, color: '#cbd5e1' }}>{description}</div>
        </div>

        <div style={{ display: 'flex', fontSize: 24, textTransform: 'uppercase', letterSpacing: 1 }}>
          {template}
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
