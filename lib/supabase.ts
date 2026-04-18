import { createClient } from '@supabase/supabase-js';
import type { PageRecord, TemplateType } from '@/lib/types';
import { getSupabasePublicKey, getSupabaseUrl } from '@/lib/supabase-env';

const url = getSupabaseUrl();
const publicKey = getSupabasePublicKey();

function createMissingClient(message: string) {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(message);
      },
    },
  ) as any;
}

export const supabase: any = url && publicKey
  ? createClient(url, publicKey)
  : createMissingClient(
      'Missing NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        '(fallback: NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    );

export async function getAllPublishedSlugs() {
  const { data } = await supabase
    .from('pages')
    .select('template,slug,updated_at')
    .eq('status', 'published')
    .limit(50000);

  return (data ?? []) as Array<{ template: string; slug: string; updated_at: string }>;
}

export async function getPageByTemplateAndSlug(template: TemplateType, slug: string) {
  const { data } = await supabase
    .from('pages')
    .select('*')
    .eq('template', template)
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  return (data ?? null) as PageRecord | null;
}

export async function getPageById(id: string) {
  const { data } = await supabase.from('pages').select('*').eq('id', id).single();
  return (data ?? null) as PageRecord | null;
}

export async function getSiblingPages(template: TemplateType, pillarId: string, currentId: string) {
  const { data } = await supabase
    .from('pages')
    .select('id,slug,template,title,primary_keyword,pillar_id')
    .eq('template', template)
    .eq('status', 'published')
    .eq('pillar_id', pillarId)
    .neq('id', currentId)
    .limit(20);

  return data ?? [];
}
