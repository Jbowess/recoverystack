import TemplatePage from '@/components/TemplatePage';
import { getPageByTemplateAndSlug } from '@/lib/supabase';
import { buildSchemaBundle, splitInternalLinks } from '@/lib/page-render';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPageByTemplateAndSlug('compatibility', slug);
  if (!page) return <main><h1>Not found</h1></main>;

  const { pillarLink, siblingLinks } = splitInternalLinks(page);
  const schemaJsonLd = buildSchemaBundle(page, '/compatibility/' + slug);

  return <TemplatePage page={page} pillarLink={pillarLink} siblingLinks={siblingLinks} schemaJsonLd={schemaJsonLd} />;
}
