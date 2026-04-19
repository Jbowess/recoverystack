/**
 * Reddit Engagement Queue
 *
 * Surfaces real Reddit questions from community_qa that match published pages
 * and generates concise, genuine comment drafts ready for manual review and posting.
 *
 * Difference from distribution-asset-generator's reddit discussion_draft:
 *   - That generates proactive posts/threads you start yourself
 *   - This generates *replies* to questions people are already asking,
 *     with the reddit_url and subreddit attached so you know exactly where to go
 *
 * Output: distribution_assets rows with channel='reddit', asset_type='comment_reply'.
 * Each row includes the source Reddit URL, subreddit, upvote count, and a
 * comment draft under 500 chars (Reddit comment sweet spot for engagement).
 *
 * Usage:
 *   npx tsx scripts/reddit-engagement-queue.ts
 *   npx tsx scripts/reddit-engagement-queue.ts --dry-run
 *   npx tsx scripts/reddit-engagement-queue.ts --min-upvotes=10
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildTrackedUrl } from '@/lib/distribution-engine';
import { MAIN_SITE_URL } from '@/lib/brand';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const MIN_UPVOTES = Number(process.argv.find((a) => a.startsWith('--min-upvotes='))?.split('=')[1] ?? process.env.REDDIT_MIN_UPVOTES ?? 3);
const LIMIT = Number(process.env.REDDIT_ENGAGEMENT_LIMIT ?? 30);

type CommunityQaRow = {
  id: string;
  keyword: string | null;
  page_slug: string | null;
  source: string | null;
  source_url: string | null;
  question: string;
  best_answer: string | null;
  upvotes: number | null;
  reply_count: number | null;
  sentiment: string | null;
  user_language: string | null;
  relevance_score: number | null;
};

type PageRow = {
  id: string;
  slug: string;
  template: string;
  title: string;
  meta_description: string | null;
  primary_keyword: string | null;
  intro: string | null;
};

function extractSubreddit(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  const match = sourceUrl.match(/reddit\.com\/r\/([^/]+)/i);
  return match ? `r/${match[1]}` : null;
}

function buildPageUrl(page: PageRow): string {
  return `${MAIN_SITE_URL}/${page.template}/${page.slug}`;
}

function buildCommentDraft(question: string, page: PageRow, qa: CommunityQaRow): string {
  const keyword = page.primary_keyword ?? page.title;
  const pageUrl = buildTrackedUrl(buildPageUrl(page), 'reddit', 'comment_reply', page.slug);

  // Use existing best_answer if available, otherwise build from page signals
  const answerSeed = qa.user_language ?? qa.best_answer ?? page.meta_description ?? '';
  const answerCore = answerSeed.length > 20
    ? answerSeed.slice(0, 200).trim()
    : `${keyword} is worth checking — the main tradeoff is accuracy vs cost.`;

  // Keep under 500 chars: answer directly, then offer the resource naturally
  const draft = `${answerCore.charAt(0).toUpperCase() + answerCore.slice(1).replace(/\.$/, '')}. I put together a full breakdown comparing the options here if it helps: ${pageUrl}`;

  return draft.length > 500 ? `${draft.slice(0, 490).trim()}...` : draft;
}

async function run(): Promise<void> {
  // Load Reddit questions with matched pages
  const { data: qaRows, error: qaError } = await supabase
    .from('community_qa')
    .select('id,keyword,page_slug,source,source_url,question,best_answer,upvotes,reply_count,sentiment,user_language,relevance_score')
    .eq('source', 'reddit')
    .not('page_slug', 'is', null)
    .not('source_url', 'is', null)
    .gte('upvotes', MIN_UPVOTES)
    .order('upvotes', { ascending: false })
    .limit(LIMIT * 3);

  if (qaError) {
    if (qaError.message.includes('community_qa')) {
      console.log('[reddit-engagement-queue] community_qa table not yet populated — run `npm run community:mine` first');
      return;
    }
    throw qaError;
  }

  if (!qaRows || qaRows.length === 0) {
    console.log(`[reddit-engagement-queue] no Reddit questions found with upvotes >= ${MIN_UPVOTES}`);
    return;
  }

  // Load corresponding published pages
  const pageSlugs = [...new Set(qaRows.map((r) => r.page_slug).filter(Boolean))] as string[];
  const { data: pages, error: pageError } = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,primary_keyword,intro')
    .eq('status', 'published')
    .in('slug', pageSlugs);

  if (pageError) throw pageError;

  const pageMap = new Map((pages ?? []).map((p) => [p.slug, p as PageRow]));

  // Deduplicate: one opportunity per source_url (don't generate multiple drafts for the same thread)
  const seenUrls = new Set<string>();
  const opportunities: Array<{ qa: CommunityQaRow; page: PageRow }> = [];

  for (const qa of qaRows as CommunityQaRow[]) {
    if (!qa.page_slug || !qa.source_url) continue;
    if (seenUrls.has(qa.source_url)) continue;
    const page = pageMap.get(qa.page_slug);
    if (!page) continue;
    seenUrls.add(qa.source_url);
    opportunities.push({ qa, page });
    if (opportunities.length >= LIMIT) break;
  }

  console.log(`[reddit-engagement-queue] ${opportunities.length} opportunities found (dryRun=${DRY_RUN})`);

  let queued = 0;

  for (const { qa, page } of opportunities) {
    const subreddit = extractSubreddit(qa.source_url);
    const commentDraft = buildCommentDraft(qa.question, page, qa);
    const trackedUrl = buildTrackedUrl(buildPageUrl(page), 'reddit', 'comment_reply', page.slug);

    console.log(`[reddit-engagement-queue] ${subreddit ?? 'unknown'} | upvotes=${qa.upvotes} | "${qa.question.slice(0, 60)}..."`);

    if (!DRY_RUN) {
      const { error } = await supabase.from('distribution_assets').upsert({
        page_id: page.id,
        page_slug: page.slug,
        page_template: page.template,
        channel: 'reddit',
        asset_type: 'comment_reply',
        status: 'draft',
        title: `Reply opportunity: ${qa.question.slice(0, 80)}`,
        hook: qa.question,
        summary: `${subreddit ?? 'Reddit'} — ${qa.upvotes ?? 0} upvotes, ${qa.reply_count ?? 0} replies`,
        body: commentDraft,
        cta_label: 'Post this reply',
        cta_url: qa.source_url!,
        hashtags: [],
        source_url: qa.source_url!,
        payload: {
          reddit_url: qa.source_url,
          subreddit,
          upvotes: qa.upvotes,
          reply_count: qa.reply_count,
          sentiment: qa.sentiment,
          original_question: qa.question,
          page_url: trackedUrl,
          asset_family: 'reddit_reply',
        },
      }, { onConflict: 'page_id,channel,asset_type' });

      if (error) console.warn(`[reddit-engagement-queue] ${page.slug}: ${error.message}`);
      else queued++;
    } else {
      queued++;
    }
  }

  console.log(`[reddit-engagement-queue] done. ${queued} reply drafts queued`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
