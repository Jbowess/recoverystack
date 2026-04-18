/**
 * news-roundup.ts
 *
 * Weekly auto-roundup generator. Runs at the end of each week (Saturday evening
 * or Sunday morning via cron). Queries published news pages from the past 7 days,
 * groups them by beat, and creates a "Recovery Tech: Week of [date]" draft roundup
 * page that links to and summarises each news item.
 *
 * The roundup page is created as a `news` template page with `news_format = 'roundup'`
 * so it slots into the same RSS feed and news index.
 *
 * Usage:
 *   npx tsx scripts/news-roundup.ts
 *   npx tsx scripts/news-roundup.ts --dry-run
 *   ROUNDUP_WEEKS_BACK=2 npx tsx scripts/news-roundup.ts   # regenerate last 2 weeks
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '@/lib/slugify';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const isDryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const weeksBack = Math.max(1, Number(process.env.ROUNDUP_WEEKS_BACK ?? 1));

// Minimum published news articles needed to justify a roundup
const MIN_ARTICLES = Number(process.env.ROUNDUP_MIN_ARTICLES ?? 3);

const BEAT_LABELS: Record<string, string> = {
  wearables: 'Wearables',
  sleep_tech: 'Sleep Tech',
  sleep_science: 'Sleep Science',
  recovery_protocols: 'Recovery Protocols',
  nutrition: 'Nutrition',
  regulatory: 'Regulatory',
  performance: 'Performance',
  general_recovery: 'Recovery',
};

type NewsArticle = {
  id: string;
  slug: string;
  title: string;
  meta_description: string | null;
  beat: string | null;
  published_at: string | null;
  primary_keyword: string | null;
};

function getWeekWindow(weeksAgo: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  // Monday of target week
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday - (weeksAgo - 1) * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const label = monday.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return { start: monday, end: sunday, label };
}

function buildRoundupSlug(weekOf: Date): string {
  const y = weekOf.getFullYear();
  const m = String(weekOf.getMonth() + 1).padStart(2, '0');
  const d = String(weekOf.getDate()).padStart(2, '0');
  return `recovery-tech-week-of-${y}-${m}-${d}`;
}

function buildRoundupTitle(label: string): string {
  return `Recovery Tech: Week of ${label}`;
}

function buildRoundupMetaDescription(articles: NewsArticle[]): string {
  const count = articles.length;
  const beats = [...new Set(articles.map((a) => a.beat).filter(Boolean))]
    .map((b) => BEAT_LABELS[b!] ?? b!)
    .slice(0, 3)
    .join(', ');
  return `This week in recovery tech: ${count} stories covering ${beats || 'wearables, sleep science, and performance technology'}.`;
}

function buildRoundupBodyJson(articles: NewsArticle[], weekLabel: string): object {
  // Group by beat
  const byBeat = new Map<string, NewsArticle[]>();
  for (const article of articles) {
    const beat = article.beat ?? 'general_recovery';
    const group = byBeat.get(beat) ?? [];
    group.push(article);
    byBeat.set(beat, group);
  }

  type Section = {
    id: string;
    heading: string;
    kind: 'paragraphs' | 'faq' | 'steps' | 'list' | 'table' | 'definition_box';
    content: unknown;
  };

  const sections: Section[] = Array.from(byBeat.entries()).map(([beat, items]) => ({
    id: `beat-${beat}`,
    heading: BEAT_LABELS[beat] ?? beat,
    kind: 'list' as const,
    content: items.map((item) => ({
      item: `[${item.title}](/news/${item.slug})${item.meta_description ? ` — ${item.meta_description.slice(0, 100)}` : ''}`,
    })),
  }));

  // Find most significant article as Editor's Pick (first published as it's most timely)
  const editorPick = articles[0];
  sections.push({
    id: 'editors-pick',
    heading: "Editor's Pick",
    kind: 'definition_box',
    content: {
      label: "This week's standout story",
      value: editorPick
        ? `[${editorPick.title}](/news/${editorPick.slug}) — ${editorPick.meta_description?.slice(0, 120) ?? 'Read the full story.'}`
        : 'No standout story this week.',
    },
  });

  sections.push({
    id: 'what-we-dont-know-yet',
    heading: "What we don't know yet",
    kind: 'paragraphs',
    content: [
      `Several of this week's stories remain developing. Watch for follow-up research, regulatory decisions, and product reviews over the coming weeks. Subscribe to RecoveryStack News for the daily brief.`,
    ],
  });

  const faqs = [
    {
      q: 'How often does RecoveryStack publish news roundups?',
      a: 'Every week. The roundup covers all published news articles from Monday to Sunday, grouped by topic.',
    },
    {
      q: 'Where can I get recovery tech news daily instead of weekly?',
      a: 'The RecoveryStack News newsletter delivers a daily brief for $1/month. Cancel anytime.',
    },
    {
      q: 'What topics does the weekly roundup cover?',
      a: 'Wearables, sleep science, recovery protocols, nutrition research, regulatory updates, and performance technology.',
    },
  ];

  return {
    news_format: 'roundup',
    verdict: [
      `Best for: catching up on a week of recovery tech news in one place`,
      `Avoid if: you need same-day coverage — subscribe to the daily newsletter instead`,
      `Bottom line: ${articles.length} stories, curated from the RecoveryStack news desk — the signal, not the noise`,
    ],
    sections,
    faqs,
    references: articles.map((a) => ({
      title: a.title,
      url: `/news/${a.slug}`,
      source: 'RecoveryStack',
      year: a.published_at ? new Date(a.published_at).getFullYear().toString() : '',
    })),
    key_takeaways: [
      `${articles.length} recovery tech stories published this week`,
      `Beats covered: ${[...new Set(articles.map((a) => a.beat).filter(Boolean))].map((b) => BEAT_LABELS[b!] ?? b!).join(', ') || 'general recovery'}`,
      `Subscribe to the newsletter for daily coverage: $1/month, cancel anytime`,
    ],
  };
}

async function generateRoundupForWeek(weeksAgo: number): Promise<void> {
  const { start, end, label } = getWeekWindow(weeksAgo);
  const slug = buildRoundupSlug(start);

  console.log(`[news-roundup] Generating roundup for week of ${label} (${start.toISOString()} → ${end.toISOString()})`);

  // Check if roundup already exists
  const { data: existing } = await supabase
    .from('pages')
    .select('id, status')
    .eq('slug', slug)
    .single();

  if (existing) {
    console.log(`[news-roundup] Roundup already exists for slug '${slug}' (status=${existing.status}) — skipping`);
    return;
  }

  // Fetch published news articles from the week window
  const { data: articles, error } = await supabase
    .from('pages')
    .select('id, slug, title, meta_description, beat, published_at, primary_keyword')
    .eq('status', 'published')
    .eq('template', 'news')
    .neq('news_format', 'roundup') // don't self-reference past roundups
    .gte('published_at', start.toISOString())
    .lte('published_at', end.toISOString())
    .order('published_at', { ascending: false });

  if (error) throw error;

  const newsArticles = (articles ?? []) as NewsArticle[];

  if (newsArticles.length < MIN_ARTICLES) {
    console.log(`[news-roundup] Only ${newsArticles.length} articles this week (minimum ${MIN_ARTICLES}) — skipping roundup`);
    return;
  }

  const title = buildRoundupTitle(label);
  const metaDescription = buildRoundupMetaDescription(newsArticles);
  const body_json = buildRoundupBodyJson(newsArticles, label);

  const primaryKeyword = `recovery tech news week of ${start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}`;

  const newPage = {
    slug,
    template: 'news',
    news_format: 'roundup',
    content_type: 'news',
    title,
    meta_description: metaDescription,
    primary_keyword: primaryKeyword,
    secondary_keywords: ['weekly recovery news', 'fitness technology news', 'wearables roundup'],
    status: 'draft',
    body_json,
    published_at: null,
    metadata: {
      news_format: 'roundup',
      roundup_week_start: start.toISOString(),
      roundup_week_end: end.toISOString(),
      article_count: newsArticles.length,
      last_verified_at: new Date().toISOString(),
      author_slug: 'editorial-team',
    },
  };

  if (isDryRun) {
    console.log(`[news-roundup] DRY RUN — would create: ${slug} (${newsArticles.length} articles)`);
    console.log(JSON.stringify(newPage, null, 2));
    return;
  }

  const { error: insertError } = await supabase.from('pages').insert(newPage);
  if (insertError) throw insertError;

  console.log(`[news-roundup] Created draft roundup '${slug}' with ${newsArticles.length} articles`);
}

async function run() {
  console.log(`[news-roundup] Generating ${weeksBack} week(s) of roundups...`);

  for (let w = 1; w <= weeksBack; w++) {
    await generateRoundupForWeek(w);
  }

  console.log('[news-roundup] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
