import type { Metadata } from 'next';
import TemplatePage from '@/components/TemplatePage';
import { getPageByTemplateAndSlug, getAllPublishedSlugs } from '@/lib/supabase';
import { buildPageMetadata, buildSchemaBundle, splitInternalLinks } from '@/lib/page-render';

export const revalidate = 3600;

export async function generateStaticParams() {
  const pages = await getAllPublishedSlugs();
  return pages.filter((p) => p.template === 'trends').map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPageByTemplateAndSlug('trends', slug);
  if (!page) return { title: 'Not found' };
  return buildPageMetadata(page, '/trends/' + slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPageByTemplateAndSlug('trends', slug);
  if (!page) return <main><h1>Not found</h1></main>;

  const { pillarLink, siblingLinks } = splitInternalLinks(page);
  const schemaJsonLd = buildSchemaBundle(page, '/trends/' + slug);

  return <TemplatePage page={page} pillarLink={pillarLink} siblingLinks={siblingLinks} schemaJsonLd={schemaJsonLd} />;
}
