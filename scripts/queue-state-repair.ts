import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

type QueueRow = {
  id: string;
  primary_keyword: string;
  status: 'new' | 'queued' | 'generated' | 'published' | 'skipped';
  metadata: Record<string, unknown> | null;
};

type PageRow = {
  id: string;
  slug: string;
  status: string;
  intro: string | null;
  body_json: { sections?: unknown[] } | null;
};

function hasPlaceholderDraft(page: PageRow) {
  const intro = page.intro?.trim() ?? '';
  const sectionCount = Array.isArray(page.body_json?.sections) ? page.body_json!.sections!.length : 0;
  return intro.startsWith('Draft pending generation for ') || sectionCount === 0;
}

async function run() {
  const { data, error } = await supabase
    .from('keyword_queue')
    .select('id,primary_keyword,status,metadata')
    .in('status', ['generated', 'queued'])
    .order('updated_at', { ascending: false })
    .limit(250);

  if (error) throw error;

  const rows = (data ?? []) as QueueRow[];
  let repaired = 0;
  let queued = 0;
  let resetToNew = 0;

  for (const row of rows) {
    const metadata = row.metadata ?? {};
    const generatedPageId = typeof metadata.generated_page_id === 'string' ? metadata.generated_page_id : null;
    const generatedSlug = typeof metadata.generated_slug === 'string' ? metadata.generated_slug : null;

    if (!generatedPageId && !generatedSlug) continue;

    let page: PageRow | null = null;

    if (generatedPageId) {
      const pageById = await supabase
        .from('pages')
        .select('id,slug,status,intro,body_json')
        .eq('id', generatedPageId)
        .maybeSingle();

      if (!pageById.error) {
        page = (pageById.data as PageRow | null) ?? null;
      }
    }

    if (!page && generatedSlug) {
      const pageBySlug = await supabase
        .from('pages')
        .select('id,slug,status,intro,body_json')
        .eq('slug', generatedSlug)
        .maybeSingle();

      if (!pageBySlug.error) {
        page = (pageBySlug.data as PageRow | null) ?? null;
      }
    }

    if (!page) {
      const nextMetadata = {
        ...metadata,
        repaired_at: new Date().toISOString(),
        repair_reason: 'missing_generated_page',
      };

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('keyword_queue')
          .update({ status: 'new', metadata: nextMetadata })
          .eq('id', row.id);

        if (updateError) throw updateError;
      }

      repaired++;
      resetToNew++;
      continue;
    }

    if (page.status === 'published' || page.status === 'approved') {
      continue;
    }

    if (page.status === 'draft' && hasPlaceholderDraft(page)) {
      const nextMetadata = {
        ...metadata,
        repaired_at: new Date().toISOString(),
        repair_reason: 'placeholder_draft_requeued',
      };

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('keyword_queue')
          .update({ status: 'queued', metadata: nextMetadata })
          .eq('id', row.id);

        if (updateError) throw updateError;
      }

      repaired++;
      queued++;
    }
  }

  console.log(
    `[queue-state-repair] scanned=${rows.length} repaired=${repaired} requeued=${queued} reset_to_new=${resetToNew} dryRun=${DRY_RUN}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
