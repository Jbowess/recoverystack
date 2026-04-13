import { supabaseAdmin } from '@/lib/supabase-admin';

const MAX_REVISIONS_PER_PAGE = 10;

/**
 * Saves the current content of a page as a revision before overwriting it.
 * Trims to MAX_REVISIONS_PER_PAGE oldest revisions per page.
 * Non-fatal — logs on error but does not throw.
 */
export async function saveRevision(
  pageId: string,
  pageSlug: string,
  intro: string | null,
  bodyJson: unknown,
  reason: string,
): Promise<void> {
  try {
    // Insert the revision
    const { error: insertError } = await supabaseAdmin.from('page_revisions').insert({
      page_id: pageId,
      page_slug: pageSlug,
      intro,
      body_json: bodyJson,
      reason,
    });

    if (insertError) {
      console.warn(`[page-revisions] failed to save revision for "${pageSlug}": ${insertError.message}`);
      return;
    }

    // Trim to last MAX_REVISIONS_PER_PAGE — delete oldest beyond cap
    const { data: revisions, error: fetchError } = await supabaseAdmin
      .from('page_revisions')
      .select('id,revised_at')
      .eq('page_id', pageId)
      .order('revised_at', { ascending: false });

    if (fetchError || !revisions) return;

    if (revisions.length > MAX_REVISIONS_PER_PAGE) {
      const toDelete = revisions.slice(MAX_REVISIONS_PER_PAGE).map((r) => r.id);
      await supabaseAdmin.from('page_revisions').delete().in('id', toDelete);
    }
  } catch (err) {
    console.warn(`[page-revisions] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
