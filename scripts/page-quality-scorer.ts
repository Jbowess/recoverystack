import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { computeSeoQualityScore } from '@/lib/seo-planning';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function collectText(page: any) {
  const parts: string[] = [page.title ?? '', page.intro ?? ''];
  for (const section of page.body_json?.sections ?? []) {
    parts.push(section.heading ?? '');
    parts.push(typeof section.content === 'string' ? section.content : JSON.stringify(section.content ?? ''));
  }
  return parts.join(' ');
}

async function run() {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('id,slug,title,intro,body_json,internal_links')
    .eq('status', 'published')
    .limit(300);

  if (error) throw error;
  if (!pages || pages.length === 0) {
    console.log('[page-quality-scorer] no published pages found');
    return;
  }

  let wrote = 0;

  for (const page of pages) {
    const [{ count: queryCount }, { count: referenceCount }, { count: visualCount }] = await Promise.all([
      supabase.from('page_query_targets').select('id', { count: 'exact', head: true }).eq('page_id', page.id),
      supabase.from('page_source_references').select('id', { count: 'exact', head: true }).eq('page_id', page.id),
      supabase.from('page_visual_assets').select('id', { count: 'exact', head: true }).eq('page_id', page.id),
    ]);

    const wordCount = countWords(collectText(page));
    const internalLinkCount = Array.isArray(page.internal_links) ? page.internal_links.length : 0;
    const score = computeSeoQualityScore({
      wordCount,
      queryCount: queryCount ?? 0,
      referenceCount: referenceCount ?? 0,
      visualCount: visualCount ?? 0,
      internalLinkCount,
    });

    await supabase.from('page_quality_scores').insert({
      page_id: page.id,
      page_slug: page.slug,
      score_type: 'seo_quality',
      total_score: score.total,
      breakdown: {
        ...score.breakdown,
        wordCount,
        internalLinkCount,
      },
    });

    // Write quality_score column (added by migration 0037).
    // metadata column added by migration 0023 — try both, fall back gracefully.
    const { error: updateErr } = await supabase
      .from('pages')
      .update({ quality_score: score.total })
      .eq('id', page.id);
    if (updateErr) {
      // Neither column exists yet — score is recorded in page_quality_scores table only
      console.warn(`[page-quality-scorer] could not write score to pages for '${page.slug}': ${updateErr.message}`);
    }

    if (score.total < 60) {
      await supabase.from('page_refresh_signals').upsert({
        page_id: page.id,
        page_slug: page.slug,
        signal_type: 'low_seo_quality',
        severity: 80 - Math.max(score.total, 20),
        status: 'open',
        detail: `SEO quality score ${score.total}`,
        metadata: score.breakdown,
      }, {
        onConflict: 'page_id,signal_type,status',
      } as any);
    }

    wrote += 1;
  }

  console.log(`[page-quality-scorer] scored ${wrote} published page(s)`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
