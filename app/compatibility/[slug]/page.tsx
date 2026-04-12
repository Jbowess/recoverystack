import type { Metadata } from 'next';
import TemplatePage from '@/components/TemplatePage';
import { getPageByTemplateAndSlug } from '@/lib/supabase';
import { buildPageMetadata, buildSchemaBundle, splitInternalLinks } from '@/lib/page-render';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPageByTemplateAndSlug('compatibility', slug);
  if (!page) return { title: 'Not found' };
  return buildPageMetadata(page, '/compatibility/' + slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPageByTemplateAndSlug('compatibility', slug);
  if (!page) return <main><h1>Not found</h1></main>;

  const { pillarLink, siblingLinks } = splitInternalLinks(page);
  const schemaJsonLd = buildSchemaBundle(page, '/compatibility/' + slug);

  return <TemplatePage page={page} pillarLink={pillarLink} siblingLinks={siblingLinks} schemaJsonLd={schemaJsonLd} />;
}
