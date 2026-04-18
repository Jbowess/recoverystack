import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildDigestSection, isDistributablePage, type DistributionPageInput } from '@/lib/distribution-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LOOKBACK_DAYS = Number(process.env.EMAIL_DIGEST_LOOKBACK_DAYS ?? 7);

async function loadDigestPages(since: string) {
  const modern = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,metadata,published_at')
    .eq('status', 'published')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(12);

  if (modern.error?.message?.includes('metadata')) {
    const legacy = await supabase
      .from('pages')
      .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,published_at')
      .eq('status', 'published')
      .gte('published_at', since)
      .order('published_at', { ascending: false })
      .limit(12);

    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []).map((row) => ({ ...row, metadata: null }));
  }

  if (modern.error) throw modern.error;
  return modern.data ?? [];
}

async function run() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const issueDate = new Date().toISOString().slice(0, 10);
  const pages = (await loadDigestPages(since) as DistributionPageInput[]).filter(isDistributablePage);
  const sections = pages.slice(0, 5).map(buildDigestSection);
  const subject = sections.length
    ? `RecoveryStack smart ring brief: ${sections[0].title}`
    : 'RecoveryStack weekly brief';
  const preheader = sections.length
    ? `${sections.length} wearable and smart-ring updates worth your attention.`
    : 'Wearable, recovery, and smart-ring updates.';
  const intro = 'This issue packages the latest published smart-ring and recovery-tech pages into a single operator-friendly brief.';

  if (DRY_RUN) {
    console.log(`[email-digest-builder] issueDate=${issueDate} sections=${sections.length}`);
    return;
  }

  const { error: upsertError } = await supabase.from('email_digest_issues').upsert({
    issue_date: issueDate,
    status: 'draft',
    subject,
    preheader,
    intro,
    sections,
    metadata: {
      lookback_days: LOOKBACK_DAYS,
      page_count: pages.length,
      market_focus: 'smart_ring',
    },
  }, {
    onConflict: 'issue_date',
  });

  if (upsertError) throw upsertError;

  console.log(`[email-digest-builder] issueDate=${issueDate} sections=${sections.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
