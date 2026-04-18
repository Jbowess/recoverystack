import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';
import { assessTrendRelevance } from '@/lib/trend-relevance';
import { isSmartRingKeyword } from '@/lib/market-focus';

export type DistributionChannel =
  | 'x'
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'reddit'
  | 'newsletter'
  | 'short_video'
  | 'affiliate_outreach';

export type DistributionAssetDraft = {
  channel: DistributionChannel;
  assetType: string;
  title: string;
  hook: string;
  summary: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  hashtags: string[];
  payload: Record<string, unknown>;
};

export type DistributionPageInput = {
  id: string;
  slug: string;
  template: string;
  title: string;
  meta_description: string | null;
  intro: string | null;
  primary_keyword: string | null;
  body_json: {
    key_takeaways?: string[];
    verdict?: string[];
    sections?: Array<{ heading?: string; content?: unknown }>;
  } | null;
  metadata?: Record<string, unknown> | null;
};

const CHANNEL_HASHTAGS: Record<DistributionChannel, string[]> = {
  x: ['RecoveryTech', 'SmartRing', 'WearableTech'],
  linkedin: ['WearableTech', 'RecoveryTech', 'FitnessTechnology'],
  instagram: ['SmartRing', 'RecoveryTech', 'SleepTracking'],
  facebook: ['RecoveryTech', 'SmartRing'],
  reddit: ['smart-ring', 'wearables'],
  newsletter: ['RecoveryStackNews'],
  short_video: ['SmartRing', 'RecoveryTech'],
  affiliate_outreach: ['partner-outreach'],
};

function sanitizeText(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function trimTo(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function slugToWords(value: string) {
  return value.replace(/-/g, ' ');
}

function buildPageUrl(page: Pick<DistributionPageInput, 'template' | 'slug'>) {
  return `${MAIN_SITE_URL}/${page.template}/${page.slug}`;
}

export function buildTrackedUrl(
  rawUrl: string,
  channel: DistributionChannel,
  assetType: string,
  contentId: string,
) {
  const url = new URL(rawUrl);
  url.searchParams.set('utm_source', channel);
  url.searchParams.set('utm_medium', 'owned_distribution');
  url.searchParams.set('utm_campaign', 'seo_distribution');
  url.searchParams.set('utm_content', `${assetType}_${contentId}`);
  return url.toString();
}

export function extractKeyPoints(page: DistributionPageInput) {
  const takeaways = (page.body_json?.key_takeaways ?? [])
    .map((item) => sanitizeText(item))
    .filter(Boolean);

  if (takeaways.length >= 3) return takeaways.slice(0, 5);

  const verdict = (page.body_json?.verdict ?? [])
    .map((item) => sanitizeText(item.replace(/^(Best for:|Avoid if:|Bottom line:)\s*/i, '')))
    .filter(Boolean);

  if (verdict.length >= 3) return verdict.slice(0, 5);

  const sections = (page.body_json?.sections ?? [])
    .map((section) => sanitizeText(section.heading))
    .filter(Boolean);

  if (sections.length >= 3) return sections.slice(0, 5);

  return [
    sanitizeText(page.primary_keyword, slugToWords(page.slug)),
    sanitizeText(page.meta_description, page.title),
    'Buyer-first comparison and product context',
  ].filter(Boolean);
}

export function inferAudience(page: DistributionPageInput) {
  if (['alternatives', 'reviews', 'costs', 'compatibility'].includes(page.template)) return 'buyers';
  if (['metrics', 'guides', 'pillars'].includes(page.template)) return 'researchers';
  if (page.template === 'news') return 'followers';
  return 'readers';
}

export function buildHook(page: DistributionPageInput) {
  const keyword = sanitizeText(page.primary_keyword, page.title);
  const audience = inferAudience(page);

  if (audience === 'buyers') {
    return trimTo(`${keyword}: what actually matters before you buy a smart ring in 2026.`, 120);
  }

  if (page.template === 'news') {
    return trimTo(`${page.title} matters because it changes the smart-ring market faster than most buyers realize.`, 120);
  }

  return trimTo(`${page.title} distilled into the practical points that matter for wearables, sleep, and recovery.`, 120);
}

function buildXThread(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const posts = [
    buildHook(page),
    ...points.slice(0, 4).map((point, index) => `${index + 1}. ${point}`),
    `Full breakdown: ${trackedUrl}`,
  ];

  return {
    title: `${page.title} X thread`,
    hook: posts[0],
    summary: trimTo(page.meta_description ?? page.intro ?? page.title, 180),
    body: posts.join('\n\n'),
    ctaLabel: 'Read the full breakdown',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.x,
    payload: { posts },
  };
}

function buildLinkedInPost(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const paragraphs = [
    buildHook(page),
    `Most content on ${sanitizeText(page.primary_keyword, page.title)} stays too generic. This piece focuses on the tradeoffs that affect actual buying and retention.`,
    ...points.slice(0, 3).map((point) => `• ${point}`),
    `Full article: ${trackedUrl}`,
  ];

  return {
    title: `${page.title} LinkedIn post`,
    hook: paragraphs[0],
    summary: trimTo(page.meta_description ?? page.title, 180),
    body: paragraphs.join('\n\n'),
    ctaLabel: `See the ${PRODUCT_NAME} angle`,
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.linkedin,
    payload: { paragraphs },
  };
}

function buildInstagramCarousel(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const slides = [
    { heading: trimTo(page.title, 60), body: buildHook(page) },
    ...points.slice(0, 4).map((point, index) => ({
      heading: `Point ${index + 1}`,
      body: trimTo(point, 110),
    })),
    { heading: 'Next step', body: `Read the full article and compare it with ${PRODUCT_NAME}.` },
  ];

  return {
    title: `${page.title} Instagram carousel`,
    hook: slides[0].body,
    summary: 'Carousel script with buyer-first slides and a final CTA.',
    body: slides.map((slide, index) => `Slide ${index + 1}: ${slide.heading}\n${slide.body}`).join('\n\n'),
    ctaLabel: 'Open the article',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.instagram,
    payload: { slides, caption: `${buildHook(page)}\n\n${trackedUrl}` },
  };
}

function buildFacebookPost(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const body = [
    buildHook(page),
    ...points.slice(0, 2),
    `Full article here: ${trackedUrl}`,
  ].join('\n\n');

  return {
    title: `${page.title} Facebook post`,
    hook: buildHook(page),
    summary: trimTo(page.meta_description ?? page.title, 180),
    body,
    ctaLabel: 'Read the article',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.facebook,
    payload: { format: 'discussion_post' },
  };
}

function buildRedditDraft(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const title = trimTo(`${sanitizeText(page.primary_keyword, page.title)}: what are people actually using right now?`, 120);
  const body = [
    `I pulled together notes on ${sanitizeText(page.primary_keyword, page.title)} and the tradeoffs that seem to matter most:`,
    ...points.slice(0, 3).map((point) => `- ${point}`),
    `Full context if helpful: ${trackedUrl}`,
    'Curious what people here would add or challenge.',
  ].join('\n\n');

  return {
    title,
    hook: title,
    summary: 'Community-safe discussion draft anchored in the published page.',
    body,
    ctaLabel: 'Use as discussion draft',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.reddit,
    payload: { subreddit_candidates: ['smart-ring', 'wearables', 'biohackers'] },
  };
}

function buildNewsletterDraft(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const intro = trimTo(page.meta_description ?? page.intro ?? page.title, 200);
  return {
    title: `${page.title} newsletter blurb`,
    hook: buildHook(page),
    summary: intro,
    body: [
      intro,
      ...points.slice(0, 3).map((point) => `- ${point}`),
      `Read the full story: ${trackedUrl}`,
      `Continue into ${PRODUCT_NAME}: ${buildTrackedUrl(PRODUCT_DESTINATION_URL, 'newsletter', 'newsletter_blurb', page.slug)}`,
    ].join('\n\n'),
    ctaLabel: 'Read the full article',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.newsletter,
    payload: { preheader: trimTo(intro, 110) },
  };
}

function buildShortVideoDraft(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  const scenes = [
    { time: '0-3s', line: buildHook(page) },
    ...points.slice(0, 3).map((point, index) => ({ time: `${4 + index * 6}-${9 + index * 6}s`, line: point })),
    { time: '22-30s', line: `Full breakdown and ${PRODUCT_NAME} angle at the link.` },
  ];

  return {
    title: `${page.title} short video script`,
    hook: scenes[0].line,
    summary: '30-second short-form video script.',
    body: scenes.map((scene) => `${scene.time}: ${scene.line}`).join('\n'),
    ctaLabel: 'Open article',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.short_video,
    payload: { scenes },
  };
}

function buildAffiliateSummary(page: DistributionPageInput, trackedUrl: string, points: string[]) {
  return {
    title: `${page.title} partner summary`,
    hook: `New comparison/review angle relevant to ${sanitizeText(page.primary_keyword, page.title)} buyers.`,
    summary: trimTo(page.meta_description ?? page.title, 180),
    body: [
      `We published a new page around ${sanitizeText(page.primary_keyword, page.title)}.`,
      `Why it matters: ${points.slice(0, 2).join(' ')}`,
      `If useful, here is the article: ${trackedUrl}`,
      `Product path: ${buildTrackedUrl(PRODUCT_DESTINATION_URL, 'affiliate_outreach', 'partner_summary', page.slug)}`,
    ].join('\n\n'),
    ctaLabel: 'Review the page',
    ctaUrl: trackedUrl,
    hashtags: CHANNEL_HASHTAGS.affiliate_outreach,
    payload: { outreach_ready: true },
  };
}

export function buildDistributionAssets(page: DistributionPageInput): DistributionAssetDraft[] {
  const pageUrl = buildPageUrl(page);
  const points = extractKeyPoints(page);

  const xUrl = buildTrackedUrl(pageUrl, 'x', 'thread', page.slug);
  const linkedinUrl = buildTrackedUrl(pageUrl, 'linkedin', 'insight_post', page.slug);
  const instagramUrl = buildTrackedUrl(pageUrl, 'instagram', 'carousel', page.slug);
  const facebookUrl = buildTrackedUrl(pageUrl, 'facebook', 'discussion_post', page.slug);
  const redditUrl = buildTrackedUrl(pageUrl, 'reddit', 'discussion_draft', page.slug);
  const newsletterUrl = buildTrackedUrl(pageUrl, 'newsletter', 'digest_blurb', page.slug);
  const shortVideoUrl = buildTrackedUrl(pageUrl, 'short_video', 'short_script', page.slug);
  const outreachUrl = buildTrackedUrl(pageUrl, 'affiliate_outreach', 'partner_summary', page.slug);

  return [
    { channel: 'x', assetType: 'thread', ...buildXThread(page, xUrl, points) },
    { channel: 'linkedin', assetType: 'insight_post', ...buildLinkedInPost(page, linkedinUrl, points) },
    { channel: 'instagram', assetType: 'carousel', ...buildInstagramCarousel(page, instagramUrl, points) },
    { channel: 'facebook', assetType: 'discussion_post', ...buildFacebookPost(page, facebookUrl, points) },
    { channel: 'reddit', assetType: 'discussion_draft', ...buildRedditDraft(page, redditUrl, points) },
    { channel: 'newsletter', assetType: 'digest_blurb', ...buildNewsletterDraft(page, newsletterUrl, points) },
    { channel: 'short_video', assetType: 'short_script', ...buildShortVideoDraft(page, shortVideoUrl, points) },
    { channel: 'affiliate_outreach', assetType: 'partner_summary', ...buildAffiliateSummary(page, outreachUrl, points) },
  ];
}

export function buildDigestSection(page: DistributionPageInput) {
  const pageUrl = buildTrackedUrl(buildPageUrl(page), 'newsletter', 'digest_issue', page.slug);
  const points = extractKeyPoints(page);

  return {
    page_slug: page.slug,
    template: page.template,
    title: page.title,
    hook: buildHook(page),
    bullets: points.slice(0, 3),
    cta_label: 'Read the full article',
    cta_url: pageUrl,
  };
}

export function buildOutreachAngle(page: DistributionPageInput) {
  if (['alternatives', 'reviews', 'costs'].includes(page.template)) {
    return 'comparison_coverage';
  }
  if (page.template === 'news') {
    return 'industry_update';
  }
  return 'category_explainer';
}

export function extractBrandMentions(page: DistributionPageInput) {
  const haystack = [
    page.title,
    page.primary_keyword ?? '',
    page.meta_description ?? '',
    page.intro ?? '',
  ].join(' ').toLowerCase();

  const candidates = ['oura', 'whoop', 'ultrahuman', 'ringconn', 'samsung', 'garmin', 'volo'];
  return candidates.filter((brand) => haystack.includes(brand));
}

export function buildAffiliateTargetUrl() {
  return PRODUCT_DESTINATION_URL;
}

export const DEFAULT_NEWSLETTER_URL = NEWSLETTER_URL;

export function isDistributablePage(page: DistributionPageInput) {
  const primary = sanitizeText(page.primary_keyword, '');
  const title = sanitizeText(page.title, '');
  const meta = sanitizeText(page.meta_description, '');
  const focus = `${primary} ${title} ${meta}`.trim();

  if (page.metadata?.market_focus === 'smart_ring') return true;
  if (isSmartRingKeyword(focus)) return true;
  return assessTrendRelevance(focus).relevant;
}
