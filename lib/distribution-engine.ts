import { MAIN_SITE_URL, NEWSLETTER_URL, PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';
import { assessTrendRelevance } from '@/lib/trend-relevance';
import { isSmartRingKeyword } from '@/lib/market-focus';

export type DistributionChannel =
  | 'x'
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'reddit'
  | 'pinterest'
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
    comparison_table?: { headers?: string[]; rows?: string[][] };
    sections?: Array<{ heading?: string; content?: unknown }>;
  } | null;
  metadata?: Record<string, unknown> | null;
};

export type BuyerPersona =
  | 'runners'
  | 'lifters'
  | 'sleep_buyers'
  | 'subscription_averse'
  | 'accuracy_first'
  | 'iphone_buyers'
  | 'android_buyers'
  | 'womens_health';

type AngleType =
  | 'myth_bust'
  | 'decision_split'
  | 'pain_point'
  | 'comparison_delta'
  | 'proof_point'
  | 'operator_brief'
  | 'objection_flip'
  | 'quote_card';

type EvidenceType =
  | 'page_claim'
  | 'page_verdict'
  | 'comparison_dataset'
  | 'app_reviews'
  | 'community_qa'
  | 'conversion_signal';

type ClaimType =
  | 'decision'
  | 'cost'
  | 'accuracy'
  | 'compatibility'
  | 'objection'
  | 'use_case'
  | 'market';

type RepurposingAngle = {
  angleType: AngleType;
  persona: BuyerPersona;
  headline: string;
  hook: string;
  evidence: string;
  cta: string;
  claimType: ClaimType;
  evidenceType: EvidenceType;
};

type RepurposingProfile = {
  pageUrl: string;
  brands: string[];
  keyPoints: string[];
  bestFor: string | null;
  avoidIf: string | null;
  strongestClaim: string;
  strongestObjection: string;
  proofPoint: string;
  comparisonDelta: string;
  dataPoint: string;
  discussionPrompt: string;
  personas: BuyerPersona[];
  angles: RepurposingAngle[];
  evidenceSignals: string[];
};

type RepurposingSeries =
  | 'smart_ring_cost_check'
  | 'subscription_trap'
  | 'buyer_regret'
  | 'best_for_avoid_if'
  | 'app_complaint_breakdown'
  | 'signal_explained';

const CHANNEL_HASHTAGS: Record<DistributionChannel, string[]> = {
  x: ['RecoveryTech', 'SmartRing', 'WearableTech'],
  linkedin: ['WearableTech', 'RecoveryTech', 'FitnessTechnology'],
  instagram: ['SmartRing', 'RecoveryTech', 'SleepTracking'],
  facebook: ['RecoveryTech', 'SmartRing'],
  reddit: ['smart-ring', 'wearables'],
  pinterest: ['SmartRing', 'RecoveryTech', 'WearableTech', 'SleepTracking', 'FitnessGadgets'],
  newsletter: ['RecoveryStackNews'],
  short_video: ['SmartRing', 'RecoveryTech'],
  affiliate_outreach: ['partner-outreach'],
};

// Maps page content signals to the subreddits most likely to engage with them
const SUBREDDIT_RULES: Array<{ pattern: RegExp; subreddits: string[] }> = [
  { pattern: /oura|whoop|ultrahuman|ringconn|galaxy ring/i, subreddits: ['r/OuraRing', 'r/QuantifiedSelf', 'r/wearables'] },
  { pattern: /bjj|jiu.jitsu/i, subreddits: ['r/bjj', 'r/martialarts', 'r/QuantifiedSelf'] },
  { pattern: /marathon|running|triathlon|endurance/i, subreddits: ['r/running', 'r/triathlon', 'r/QuantifiedSelf'] },
  { pattern: /crossfit|wod|metcon/i, subreddits: ['r/crossfit', 'r/fitness', 'r/QuantifiedSelf'] },
  { pattern: /sleep|circadian|deep sleep|rem/i, subreddits: ['r/sleep', 'r/QuantifiedSelf', 'r/insomnia'] },
  { pattern: /cold plunge|ice bath|cold therapy/i, subreddits: ['r/coldplunge', 'r/biohacking', 'r/QuantifiedSelf'] },
  { pattern: /sauna/i, subreddits: ['r/sauna', 'r/biohacking', 'r/QuantifiedSelf'] },
  { pattern: /women|cycle.track|menstrual/i, subreddits: ['r/xxfitness', 'r/QuantifiedSelf', 'r/Fitness'] },
  { pattern: /hrv|heart rate variab/i, subreddits: ['r/QuantifiedSelf', 'r/Garmin', 'r/wearables'] },
  { pattern: /subscription|no.fee|one.time/i, subreddits: ['r/wearables', 'r/QuantifiedSelf', 'r/frugal'] },
  { pattern: /strength|lifting|gym|powerlifting/i, subreddits: ['r/weightlifting', 'r/powerlifting', 'r/QuantifiedSelf'] },
  { pattern: /weight.loss|fat.loss/i, subreddits: ['r/loseit', 'r/fitness', 'r/QuantifiedSelf'] },
];

function inferSubreddits(page: DistributionPageInput, brands: string[]): string[] {
  const haystack = [
    page.title,
    page.primary_keyword ?? '',
    page.meta_description ?? '',
    page.intro ?? '',
    ...brands,
  ].join(' ');

  for (const rule of SUBREDDIT_RULES) {
    if (rule.pattern.test(haystack)) return rule.subreddits;
  }

  return ['r/wearables', 'r/QuantifiedSelf', 'r/Fitness'];
}

const PERSONA_COPY: Record<BuyerPersona, { label: string; hook: string; cta: string }> = {
  runners: {
    label: 'Runners',
    hook: 'Focus on overnight recovery signal and training-readiness usefulness.',
    cta: 'See the runner shortlist',
  },
  lifters: {
    label: 'Lifters',
    hook: 'Focus on comfort, adherence, and whether recovery scores are actionable.',
    cta: 'See the lifting shortlist',
  },
  sleep_buyers: {
    label: 'Sleep-first buyers',
    hook: 'Focus on overnight comfort, sleep staging, and habit stickiness.',
    cta: 'See the sleep-focused picks',
  },
  subscription_averse: {
    label: 'Subscription-averse buyers',
    hook: 'Focus on total cost of ownership and feature lock-in risk.',
    cta: 'See the no-subscription angle',
  },
  accuracy_first: {
    label: 'Accuracy-first buyers',
    hook: 'Focus on validation context, limitations, and signal quality.',
    cta: 'See the accuracy breakdown',
  },
  iphone_buyers: {
    label: 'iPhone buyers',
    hook: 'Focus on app quality, compatibility, and ecosystem tradeoffs.',
    cta: 'See the iPhone fit',
  },
  android_buyers: {
    label: 'Android buyers',
    hook: 'Focus on setup friction, compatibility, and app support quality.',
    cta: 'See the Android fit',
  },
  womens_health: {
    label: "Women's health buyers",
    hook: 'Focus on cycle-aware tracking, comfort, and feature trust.',
    cta: "See the women's health fit",
  },
};

function sanitizeText(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function trimTo(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function slugToWords(value: string) {
  return value.replace(/-/g, ' ');
}

function buildPageUrl(page: Pick<DistributionPageInput, 'template' | 'slug'>) {
  return `${MAIN_SITE_URL}/${page.template}/${page.slug}`;
}

function extractStrings(value: unknown): string[] {
  if (typeof value === 'string') return [sanitizeText(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((item) => extractStrings(item));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => extractStrings(item));
  }
  return [];
}

function dedupe(values: string[], limit = values.length) {
  return Array.from(new Set(values.map((value) => sanitizeText(value)).filter(Boolean))).slice(0, limit);
}

function extractNumbers(values: string[]) {
  return values.filter((value) => /\d/.test(value));
}

function inferClaimType(page: DistributionPageInput): ClaimType {
  if (page.template === 'costs') return 'cost';
  if (page.template === 'metrics') return 'accuracy';
  if (page.template === 'compatibility') return 'compatibility';
  if (page.template === 'alternatives' || page.template === 'reviews') return 'decision';
  return 'market';
}

function inferSeries(page: DistributionPageInput): RepurposingSeries {
  if (page.template === 'costs') return 'smart_ring_cost_check';
  if (page.template === 'metrics') return 'signal_explained';
  if ((page.primary_keyword ?? '').toLowerCase().includes('subscription')) return 'subscription_trap';
  if (page.template === 'alternatives' || page.template === 'reviews') return 'best_for_avoid_if';
  if ((page.meta_description ?? '').toLowerCase().includes('complaint')) return 'app_complaint_breakdown';
  return 'buyer_regret';
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
  const takeaways = dedupe((page.body_json?.key_takeaways ?? []).map((item) => sanitizeText(item)), 6);
  if (takeaways.length >= 3) return takeaways;

  const verdict = dedupe(
    (page.body_json?.verdict ?? [])
      .map((item) => sanitizeText(item.replace(/^(Best for:|Avoid if:|Bottom line:)\s*/i, ''))),
    6,
  );
  if (verdict.length >= 3) return verdict;

  const sectionSignals = dedupe(
    (page.body_json?.sections ?? []).flatMap((section) => [
      sanitizeText(section.heading),
      ...extractStrings(section.content).slice(0, 2),
    ]),
    6,
  );
  if (sectionSignals.length >= 3) return sectionSignals;

  return dedupe([
    sanitizeText(page.primary_keyword, slugToWords(page.slug)),
    sanitizeText(page.meta_description, page.title),
    'Buyer-first comparison and product context',
  ], 5);
}

function extractBestFor(page: DistributionPageInput) {
  const match = (page.body_json?.verdict ?? []).find((item) => /^Best for:/i.test(item));
  return match ? sanitizeText(match.replace(/^Best for:\s*/i, '')) : null;
}

function extractAvoidIf(page: DistributionPageInput) {
  const match = (page.body_json?.verdict ?? []).find((item) => /^Avoid if:/i.test(item));
  return match ? sanitizeText(match.replace(/^Avoid if:\s*/i, '')) : null;
}

function extractEvidenceSignals(page: DistributionPageInput, brands: string[]) {
  const metadata = page.metadata ?? {};
  const signals: string[] = [];

  const evidence = extractStrings(metadata.distribution_evidence);
  signals.push(...evidence.slice(0, 4));

  const appReviewSignals = extractStrings(metadata.app_review_signals);
  signals.push(...appReviewSignals.slice(0, 3));

  const communitySignals = extractStrings(metadata.community_signals);
  signals.push(...communitySignals.slice(0, 3));

  const conversionSignals = extractStrings(metadata.conversion_signals);
  signals.push(...conversionSignals.slice(0, 2));

  if (signals.length === 0 && brands.length > 0) {
    signals.push(`${brands[0]} is part of the active smart-ring comparison set.`);
  }

  return dedupe(signals, 8);
}

function inferPersonas(page: DistributionPageInput, keyPoints: string[]) {
  const haystack = [
    page.slug,
    page.title,
    page.primary_keyword ?? '',
    page.meta_description ?? '',
    ...keyPoints,
  ].join(' ').toLowerCase();

  const personas = new Set<BuyerPersona>();
  if (/runner|marathon|triathlon|endurance/.test(haystack)) personas.add('runners');
  if (/strength|lifting|lifter|gym/.test(haystack)) personas.add('lifters');
  if (/sleep|overnight|comfort/.test(haystack)) personas.add('sleep_buyers');
  if (/subscription|cost|price|fee|budget/.test(haystack)) personas.add('subscription_averse');
  if (/accuracy|validated|validation|hrv|sensor/.test(haystack)) personas.add('accuracy_first');
  if (/iphone|ios/.test(haystack)) personas.add('iphone_buyers');
  if (/android|galaxy|pixel/.test(haystack)) personas.add('android_buyers');
  if (/women|cycle|temperature/.test(haystack)) personas.add('womens_health');

  if (personas.size === 0) {
    personas.add('sleep_buyers');
    personas.add('subscription_averse');
    personas.add('accuracy_first');
  }

  return Array.from(personas).slice(0, 4);
}

function buildDiscussionPrompt(page: DistributionPageInput, strongestObjection: string) {
  const keyword = sanitizeText(page.primary_keyword, page.title);
  return `What would you challenge about ${keyword}: ${strongestObjection.toLowerCase()}?`;
}

function buildAngles(page: DistributionPageInput, profile: Omit<RepurposingProfile, 'angles'>): RepurposingAngle[] {
  const claimType = inferClaimType(page);
  const baseEvidence = profile.evidenceSignals[0] ?? profile.proofPoint;

  const primaryPersona = profile.personas[0];
  const secondaryPersona = profile.personas[1] ?? primaryPersona;

  return [
    {
      angleType: 'myth_bust',
      persona: primaryPersona,
      headline: `${sanitizeText(page.primary_keyword, page.title)} is not the decision. The tradeoff is.`,
      hook: `Most buyers frame ${sanitizeText(page.primary_keyword, page.title)} the wrong way. ${profile.strongestClaim}`,
      evidence: baseEvidence,
      cta: `Read the full breakdown: ${profile.pageUrl}`,
      claimType,
      evidenceType: profile.evidenceSignals.length > 0 ? 'comparison_dataset' : 'page_claim',
    },
    {
      angleType: 'decision_split',
      persona: primaryPersona,
      headline: `Buy one option for ${profile.bestFor ?? 'comfort and fit'}. Avoid it if ${profile.avoidIf ?? 'ongoing cost matters'}.`,
      hook: profile.comparisonDelta,
      evidence: profile.dataPoint,
      cta: `Compare the full shortlist: ${profile.pageUrl}`,
      claimType: 'decision',
      evidenceType: /\d/.test(profile.dataPoint) ? 'comparison_dataset' : 'page_verdict',
    },
    {
      angleType: 'pain_point',
      persona: secondaryPersona,
      headline: profile.strongestObjection,
      hook: `The friction point buyers keep running into is simple: ${profile.strongestObjection.toLowerCase()}.`,
      evidence: profile.evidenceSignals[1] ?? profile.proofPoint,
      cta: `See the buyer-first fix: ${profile.pageUrl}`,
      claimType: 'objection',
      evidenceType: profile.evidenceSignals.some((signal) => /review|complaint|pain/i.test(signal)) ? 'app_reviews' : 'page_claim',
    },
    {
      angleType: 'proof_point',
      persona: secondaryPersona,
      headline: profile.proofPoint,
      hook: `One proof point matters more than the generic feature list: ${profile.proofPoint}`,
      evidence: profile.dataPoint,
      cta: `Read the full evidence trail: ${profile.pageUrl}`,
      claimType,
      evidenceType: /\d/.test(profile.dataPoint) ? 'comparison_dataset' : 'community_qa',
    },
    {
      angleType: 'operator_brief',
      persona: primaryPersona,
      headline: `${page.title}: operator brief`,
      hook: `If you only keep three points from ${page.title}, keep these.`,
      evidence: profile.keyPoints.slice(0, 3).join(' | '),
      cta: `Open the full page: ${profile.pageUrl}`,
      claimType: 'market',
      evidenceType: 'conversion_signal',
    },
    {
      angleType: 'quote_card',
      persona: secondaryPersona,
      headline: trimTo(profile.strongestClaim, 85),
      hook: trimTo(profile.strongestClaim, 110),
      evidence: trimTo(profile.proofPoint, 110),
      cta: `Get the full context: ${profile.pageUrl}`,
      claimType,
      evidenceType: 'page_claim',
    },
  ];
}

function buildRepurposingProfile(page: DistributionPageInput): RepurposingProfile {
  const pageUrl = buildPageUrl(page);
  const keyPoints = extractKeyPoints(page);
  const brands = extractBrandMentions(page);
  const bestFor = extractBestFor(page);
  const avoidIf = extractAvoidIf(page);
  const numericPoints = extractNumbers(keyPoints);
  const evidenceSignals = extractEvidenceSignals(page, brands);
  const personas = inferPersonas(page, keyPoints);
  const strongestClaim = keyPoints[0] ?? sanitizeText(page.meta_description, page.title);
  const strongestObjection = avoidIf
    ?? evidenceSignals.find((signal) => /subscription|battery|sync|accuracy|cost|comfort/i.test(signal))
    ?? 'The feature list does not matter if comfort, cost, or adherence breaks first.';
  const proofPoint = evidenceSignals[0] ?? numericPoints[0] ?? strongestClaim;
  const comparisonDelta =
    page.template === 'costs'
      ? `${sanitizeText(page.title)} should be framed as year-one cost, not sticker price alone.`
      : page.template === 'alternatives' || page.template === 'reviews'
        ? `${sanitizeText(page.title)} is really a best-for versus avoid-if decision split.`
        : `${sanitizeText(page.title)} should be repurposed around one buyer decision, not a generic summary.`;
  const dataPoint = numericPoints[0] ?? evidenceSignals.find((signal) => /\d/.test(signal)) ?? proofPoint;
  const discussionPrompt = buildDiscussionPrompt(page, strongestObjection);

  const profileBase = {
    pageUrl,
    brands,
    keyPoints,
    bestFor,
    avoidIf,
    strongestClaim,
    strongestObjection,
    proofPoint,
    comparisonDelta,
    dataPoint,
    discussionPrompt,
    personas,
    evidenceSignals,
  };

  return {
    ...profileBase,
    angles: buildAngles(page, profileBase),
  };
}

export function inferAudience(page: DistributionPageInput) {
  if (['alternatives', 'reviews', 'costs', 'compatibility'].includes(page.template)) return 'buyers';
  if (['metrics', 'guides', 'pillars'].includes(page.template)) return 'researchers';
  if (page.template === 'news') return 'followers';
  return 'readers';
}

export function buildHook(page: DistributionPageInput) {
  const profile = buildRepurposingProfile(page);
  return trimTo(profile.angles[0]?.hook ?? sanitizeText(page.meta_description, page.title), 120);
}

function computeRepurposingScore(page: DistributionPageInput, angle: RepurposingAngle, profile: RepurposingProfile) {
  let score = 40;
  if (['alternatives', 'reviews', 'costs', 'compatibility'].includes(page.template)) score += 18;
  if (profile.evidenceSignals.length >= 3) score += 14;
  if (/\d/.test(profile.dataPoint)) score += 10;
  if (profile.brands.length > 0) score += 6;
  if (angle.angleType === 'decision_split' || angle.angleType === 'myth_bust') score += 6;
  if (angle.persona === 'subscription_averse' || angle.persona === 'accuracy_first') score += 4;
  return Math.min(99, score);
}

function createAsset(
  page: DistributionPageInput,
  channel: DistributionChannel,
  assetType: string,
  angle: RepurposingAngle,
  hook: string,
  summary: string,
  body: string,
  ctaLabel: string,
  ctaUrl: string,
  extraPayload: Record<string, unknown> = {},
): DistributionAssetDraft {
  const personaCopy = PERSONA_COPY[angle.persona];
  const profile = buildRepurposingProfile(page);

  return {
    channel,
    assetType,
    title: `${page.title} ${assetType.replace(/_/g, ' ')}`.trim(),
    hook,
    summary,
    body,
    ctaLabel,
    ctaUrl,
    hashtags: CHANNEL_HASHTAGS[channel],
    payload: {
      persona: angle.persona,
      persona_label: personaCopy.label,
      angle_type: angle.angleType,
      claim_type: angle.claimType,
      evidence_type: angle.evidenceType,
      source_signals: profile.evidenceSignals.slice(0, 4),
      key_points: profile.keyPoints.slice(0, 4),
      brands: profile.brands,
      strongest_claim: profile.strongestClaim,
      strongest_objection: profile.strongestObjection,
      proof_point: profile.proofPoint,
      repurposing_score: computeRepurposingScore(page, angle, profile),
      recurring_series: inferSeries(page),
      repurposing_version: 'v2_angle_driven',
      ...extraPayload,
    },
  };
}

function buildXThread(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const posts = [
    trimTo(angle.hook, 240),
    `1. ${profile.strongestClaim}`,
    `2. ${profile.comparisonDelta}`,
    `3. ${angle.evidence}`,
    `4. Best for: ${profile.bestFor ?? PERSONA_COPY[angle.persona].hook}`,
    `5. Avoid if: ${profile.avoidIf ?? profile.strongestObjection}`,
    `Full breakdown: ${trackedUrl}`,
  ];

  return createAsset(
    page,
    'x',
    'thread',
    angle,
    posts[0],
    trimTo(angle.evidence, 180),
    posts.join('\n\n'),
    'Read the full breakdown',
    trackedUrl,
    { posts, asset_family: 'argument_bundle' },
  );
}

function buildXHotTake(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle) {
  const body = [
    trimTo(angle.headline, 220),
    angle.evidence,
    trackedUrl,
  ].join('\n\n');

  return createAsset(
    page,
    'x',
    'hot_take',
    angle,
    trimTo(angle.headline, 120),
    trimTo(angle.evidence, 150),
    body,
    'Open the article',
    trackedUrl,
    { asset_family: 'claim_first' },
  );
}

function buildLinkedInInsight(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const paragraphs = [
    angle.hook,
    `The interesting part is not the headline keyword. The interesting part is the buyer tension underneath it: ${profile.comparisonDelta.toLowerCase()}`,
    `Evidence: ${angle.evidence}`,
    `Operator takeaway for ${PERSONA_COPY[angle.persona].label.toLowerCase()}: ${PERSONA_COPY[angle.persona].hook}`,
    `Full article: ${trackedUrl}`,
  ];

  return createAsset(
    page,
    'linkedin',
    'insight_post',
    angle,
    paragraphs[0],
    trimTo(angle.evidence, 180),
    paragraphs.join('\n\n'),
    `See the ${PRODUCT_NAME} angle`,
    trackedUrl,
    { paragraphs, asset_family: 'operator_insight' },
  );
}

function buildLinkedInOperatorMemo(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const bullets = [
    profile.strongestClaim,
    profile.proofPoint,
    profile.strongestObjection,
  ];

  return createAsset(
    page,
    'linkedin',
    'operator_memo',
    angle,
    angle.headline,
    trimTo(profile.comparisonDelta, 180),
    [
      `Operator memo on ${sanitizeText(page.primary_keyword, page.title)}:`,
      ...bullets.map((bullet) => `- ${bullet}`),
      `Full context: ${trackedUrl}`,
    ].join('\n\n'),
    'Read the memo source',
    trackedUrl,
    { bullets, asset_family: 'operator_brief' },
  );
}

function buildInstagramCarousel(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const slides = [
    { heading: trimTo(angle.headline, 60), body: trimTo(angle.hook, 110) },
    { heading: 'What most buyers miss', body: trimTo(profile.comparisonDelta, 110) },
    { heading: 'Best for', body: trimTo(profile.bestFor ?? PERSONA_COPY[angle.persona].hook, 110) },
    { heading: 'Avoid if', body: trimTo(profile.avoidIf ?? profile.strongestObjection, 110) },
    { heading: 'Evidence', body: trimTo(angle.evidence, 110) },
    { heading: 'Next step', body: `Read the full article and compare it with ${PRODUCT_NAME}.` },
  ];

  return createAsset(
    page,
    'instagram',
    'carousel',
    angle,
    slides[0].body,
    'Carousel script built around one decision argument.',
    slides.map((slide, index) => `Slide ${index + 1}: ${slide.heading}\n${slide.body}`).join('\n\n'),
    'Open the article',
    trackedUrl,
    { slides, caption: `${angle.hook}\n\n${trackedUrl}`, asset_family: 'decision_carousel' },
  );
}

function buildInstagramDecisionCards(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const cards = [
    { label: 'Buy if', value: profile.bestFor ?? PERSONA_COPY[angle.persona].hook },
    { label: 'Skip if', value: profile.avoidIf ?? profile.strongestObjection },
    { label: 'Proof', value: angle.evidence },
  ];

  return createAsset(
    page,
    'instagram',
    'decision_cards',
    angle,
    trimTo(profile.strongestClaim, 120),
    'Decision-card pack for quick buyer sorting.',
    cards.map((card, index) => `Card ${index + 1}: ${card.label}\n${trimTo(card.value, 120)}`).join('\n\n'),
    'See the full comparison',
    trackedUrl,
    { cards, asset_family: 'decision_pack' },
  );
}

function buildFacebookPost(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  return createAsset(
    page,
    'facebook',
    'discussion_post',
    angle,
    trimTo(angle.hook, 120),
    trimTo(profile.proofPoint, 180),
    [
      angle.hook,
      `Most pages stop at specs. This one is more useful because it answers the buyer question directly: ${profile.comparisonDelta}`,
      `Proof point: ${angle.evidence}`,
      `Full article: ${trackedUrl}`,
    ].join('\n\n'),
    'Read the article',
    trackedUrl,
    { asset_family: 'discussion' },
  );
}

function buildRedditDiscussion(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const title = trimTo(`${sanitizeText(page.primary_keyword, page.title)}: ${profile.strongestObjection.toLowerCase()}`, 120);
  const subreddits = inferSubreddits(page, profile.brands);

  return createAsset(
    page,
    'reddit',
    'discussion_draft',
    angle,
    title,
    'Community-safe discussion draft anchored in one objection or tradeoff.',
    [
      `I pulled together notes on ${sanitizeText(page.primary_keyword, page.title)} and the part I keep coming back to is this: ${profile.strongestObjection.toLowerCase()}.`,
      `The strongest proof point I found was: ${angle.evidence}`,
      `Best for: ${profile.bestFor ?? PERSONA_COPY[angle.persona].hook}`,
      `Avoid if: ${profile.avoidIf ?? 'you want a simpler or cheaper setup'}`,
      `Full context if useful: ${trackedUrl}`,
      profile.discussionPrompt,
    ].join('\n\n'),
    'Use as discussion draft',
    trackedUrl,
    { subreddit_candidates: subreddits, asset_family: 'discussion_prompt' },
  );
}

function buildPinterestPin(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const keyword = sanitizeText(page.primary_keyword, page.title);
  const pinTitle = trimTo(`${keyword.charAt(0).toUpperCase() + keyword.slice(1)} — ${new Date().getFullYear()} Guide`, 100);

  const description = [
    trimTo(angle.hook, 150),
    profile.bestFor ? `Best for: ${profile.bestFor}.` : '',
    profile.avoidIf ? `Skip if: ${profile.avoidIf}.` : '',
    `Full comparison and verdict at the link.`,
  ].filter(Boolean).join(' ');

  const boards = page.template === 'protocols'
    ? ['Recovery Protocols', 'Fitness & Performance', 'Athlete Recovery']
    : page.template === 'metrics'
    ? ['HRV & Health Metrics', 'Wearable Tech', 'Biohacking']
    : ['Smart Ring Reviews', 'Wearable Tech Picks', 'Best Fitness Trackers'];

  return createAsset(
    page,
    'pinterest',
    'pin',
    angle,
    pinTitle,
    trimTo(description, 200),
    description,
    'See the full guide',
    trackedUrl,
    { pin_title: pinTitle, board_suggestions: boards, asset_family: 'pinterest_pin' },
  );
}

function buildProtocolVideoScript(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const keyword = sanitizeText(page.primary_keyword, page.title);

  const sections = page.body_json?.sections ?? [];
  const steps = sections
    .filter((s) => s.heading && typeof s.heading === 'string')
    .slice(0, 4)
    .map((s) => trimTo(sanitizeText(s.heading as string), 90));

  const scriptSteps = steps.length >= 2 ? steps : profile.keyPoints.slice(0, 4);

  const scenes: Array<{ time: string; line: string }> = [
    { time: '0-5s', line: `Hook: "${trimTo(`Most people get ${keyword} wrong. Here's the exact protocol.`, 100)}"` },
    { time: '6-12s', line: `Why it matters: ${trimTo(profile.proofPoint, 90)}` },
    ...scriptSteps.map((step, i) => ({
      time: `${13 + i * 9}-${21 + i * 9}s`,
      line: `Step ${i + 1}: ${step}`,
    })),
    { time: `${13 + scriptSteps.length * 9}s+`, line: `CTA: "Full protocol at the link in bio — ${trackedUrl}"` },
  ];

  return createAsset(
    page,
    'short_video',
    'protocol_script',
    angle,
    scenes[0].line,
    `Step-by-step protocol script: ${scriptSteps.length} steps.`,
    scenes.map((s) => `${s.time}: ${s.line}`).join('\n'),
    'Full protocol at link in bio',
    trackedUrl,
    { scenes, step_count: scriptSteps.length, steps: scriptSteps, asset_family: 'protocol_walkthrough' },
  );
}

function buildNewsletterBlurb(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const productUrl = buildTrackedUrl(PRODUCT_DESTINATION_URL, 'newsletter', 'newsletter_blurb', page.slug);

  return createAsset(
    page,
    'newsletter',
    'digest_blurb',
    angle,
    trimTo(angle.hook, 120),
    trimTo(profile.proofPoint, 180),
    [
      angle.hook,
      `Why it matters: ${profile.comparisonDelta}`,
      `Proof point: ${angle.evidence}`,
      `Best for: ${profile.bestFor ?? PERSONA_COPY[angle.persona].label}`,
      `Read the full story: ${trackedUrl}`,
      `Continue into ${PRODUCT_NAME}: ${productUrl}`,
    ].join('\n\n'),
    'Read the full article',
    trackedUrl,
    { preheader: trimTo(profile.proofPoint, 110), product_url: productUrl, asset_family: 'newsletter_argument' },
  );
}

function buildNewsletterOperatorBrief(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const sections = [
    `Claim: ${profile.strongestClaim}`,
    `Proof: ${profile.proofPoint}`,
    `Objection: ${profile.strongestObjection}`,
  ];

  return createAsset(
    page,
    'newsletter',
    'operator_brief',
    angle,
    trimTo(angle.headline, 120),
    'Operator-style briefing block for newsletter placement.',
    [
      `Operator brief for ${PERSONA_COPY[angle.persona].label.toLowerCase()}:`,
      ...sections.map((section) => `- ${section}`),
      `Open the full page: ${trackedUrl}`,
    ].join('\n\n'),
    'Open the source page',
    trackedUrl,
    { sections, asset_family: 'newsletter_brief' },
  );
}

function buildShortVideo(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const scenes = [
    { time: '0-3s', line: trimTo(angle.headline, 110) },
    { time: '4-8s', line: trimTo(profile.comparisonDelta, 110) },
    { time: '9-14s', line: trimTo(`Best for: ${profile.bestFor ?? PERSONA_COPY[angle.persona].hook}`, 110) },
    { time: '15-20s', line: trimTo(`Avoid if: ${profile.avoidIf ?? profile.strongestObjection}`, 110) },
    { time: '21-30s', line: trimTo(`Full breakdown at the link: ${trackedUrl}`, 110) },
  ];

  return createAsset(
    page,
    'short_video',
    'short_script',
    angle,
    scenes[0].line,
    'Short-form script built around one decision conflict.',
    scenes.map((scene) => `${scene.time}: ${scene.line}`).join('\n'),
    'Open article',
    trackedUrl,
    { scenes, asset_family: 'short_video_argument' },
  );
}

function buildObjectionVideo(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const scenes = [
    { time: '0-4s', line: trimTo(profile.strongestObjection, 110) },
    { time: '5-10s', line: trimTo(`Most buyers miss this: ${profile.proofPoint}`, 110) },
    { time: '11-18s', line: trimTo(profile.comparisonDelta, 110) },
    { time: '19-28s', line: trimTo(`Read the full breakdown: ${trackedUrl}`, 110) },
  ];

  return createAsset(
    page,
    'short_video',
    'objection_script',
    angle,
    scenes[0].line,
    'Short-form objection-led script.',
    scenes.map((scene) => `${scene.time}: ${scene.line}`).join('\n'),
    'Read the article',
    trackedUrl,
    { scenes, asset_family: 'short_video_objection' },
  );
}

function buildAffiliateSummary(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const productPath = buildTrackedUrl(PRODUCT_DESTINATION_URL, 'affiliate_outreach', 'partner_summary', page.slug);

  return createAsset(
    page,
    'affiliate_outreach',
    'partner_summary',
    angle,
    `New comparison/review angle relevant to ${sanitizeText(page.primary_keyword, page.title)} buyers.`,
    trimTo(profile.proofPoint, 180),
    [
      `We published a new page around ${sanitizeText(page.primary_keyword, page.title)}.`,
      `Why it matters: ${profile.comparisonDelta}`,
      `Best fit for coverage: ${PERSONA_COPY[angle.persona].label}.`,
      `Evidence point: ${angle.evidence}`,
      `Article: ${trackedUrl}`,
      `Product path: ${productPath}`,
    ].join('\n\n'),
    'Review the page',
    trackedUrl,
    { outreach_ready: true, product_path: productPath, asset_family: 'partner_angle' },
  );
}

function buildSeriesAsset(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  const series = inferSeries(page);
  const label = series.replace(/_/g, ' ');
  return createAsset(
    page,
    'newsletter',
    'series_block',
    angle,
    `${label}: ${trimTo(profile.strongestClaim, 90)}`,
    `Recurring series block for ${label}.`,
    [
      `Series: ${label}`,
      `Claim: ${profile.strongestClaim}`,
      `Proof: ${profile.proofPoint}`,
      `Avoid if: ${profile.avoidIf ?? profile.strongestObjection}`,
      `Open the full page: ${trackedUrl}`,
    ].join('\n\n'),
    'Read the full article',
    trackedUrl,
    { asset_family: 'recurring_series', recurring_series: series },
  );
}

function buildCreatorBrief(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  return createAsset(
    page,
    'affiliate_outreach',
    'creator_brief',
    angle,
    `Creator brief: ${trimTo(profile.strongestClaim, 90)}`,
    'Creator-ready talking points and hook pack.',
    [
      `Hook: ${angle.hook}`,
      `Talking point 1: ${profile.strongestClaim}`,
      `Talking point 2: ${profile.comparisonDelta}`,
      `Talking point 3: ${profile.strongestObjection}`,
      `Proof point: ${angle.evidence}`,
      `CTA: ${trackedUrl}`,
    ].join('\n\n'),
    'Review the brief',
    trackedUrl,
    { asset_family: 'creator_enablement', target_type: 'creator' },
  );
}

function buildPressBrief(page: DistributionPageInput, trackedUrl: string, angle: RepurposingAngle, profile: RepurposingProfile) {
  return createAsset(
    page,
    'affiliate_outreach',
    'press_brief',
    angle,
    `Press brief: ${trimTo(profile.comparisonDelta, 90)}`,
    'Press-ready angle with one clear claim and proof point.',
    [
      `Headline angle: ${profile.comparisonDelta}`,
      `Why it matters now: ${profile.strongestClaim}`,
      `Evidence: ${angle.evidence}`,
      `Best for: ${profile.bestFor ?? PERSONA_COPY[angle.persona].label}`,
      `Source page: ${trackedUrl}`,
    ].join('\n\n'),
    'Review the angle',
    trackedUrl,
    { asset_family: 'press_enablement', target_type: 'press' },
  );
}

export function buildDistributionAssets(page: DistributionPageInput): DistributionAssetDraft[] {
  const profile = buildRepurposingProfile(page);
  const [primaryAngle, secondaryAngle, objectionAngle, proofAngle, operatorAngle, quoteAngle] = profile.angles;
  const isProtocol = page.template === 'protocols';
  const supportsPinterest = ['guides', 'alternatives', 'costs', 'compatibility', 'metrics'].includes(page.template);

  const xUrl = buildTrackedUrl(profile.pageUrl, 'x', 'thread', page.slug);
  const linkedinUrl = buildTrackedUrl(profile.pageUrl, 'linkedin', 'insight_post', page.slug);
  const instagramUrl = buildTrackedUrl(profile.pageUrl, 'instagram', 'carousel', page.slug);
  const facebookUrl = buildTrackedUrl(profile.pageUrl, 'facebook', 'discussion_post', page.slug);
  const redditUrl = buildTrackedUrl(profile.pageUrl, 'reddit', 'discussion_draft', page.slug);
  const pinterestUrl = buildTrackedUrl(profile.pageUrl, 'pinterest', 'pin', page.slug);
  const newsletterUrl = buildTrackedUrl(profile.pageUrl, 'newsletter', 'digest_blurb', page.slug);
  const shortVideoUrl = buildTrackedUrl(profile.pageUrl, 'short_video', 'short_script', page.slug);
  const outreachUrl = buildTrackedUrl(profile.pageUrl, 'affiliate_outreach', 'partner_summary', page.slug);

  const assets: DistributionAssetDraft[] = [
    buildXThread(page, xUrl, primaryAngle, profile),
    buildXHotTake(page, xUrl, proofAngle),
    buildLinkedInInsight(page, linkedinUrl, operatorAngle, profile),
    buildLinkedInOperatorMemo(page, linkedinUrl, operatorAngle, profile),
    buildInstagramCarousel(page, instagramUrl, secondaryAngle, profile),
    buildInstagramDecisionCards(page, instagramUrl, quoteAngle, profile),
    buildFacebookPost(page, facebookUrl, primaryAngle, profile),
    buildRedditDiscussion(page, redditUrl, objectionAngle, profile),
    buildNewsletterBlurb(page, newsletterUrl, proofAngle, profile),
    buildNewsletterOperatorBrief(page, newsletterUrl, operatorAngle, profile),
    buildSeriesAsset(page, newsletterUrl, primaryAngle, profile),
    // Protocol pages get a step-structured video script; others get the argument-led one
    isProtocol
      ? buildProtocolVideoScript(page, shortVideoUrl, primaryAngle, profile)
      : buildShortVideo(page, shortVideoUrl, secondaryAngle, profile),
    buildObjectionVideo(page, shortVideoUrl, objectionAngle, profile),
    buildAffiliateSummary(page, outreachUrl, operatorAngle, profile),
    buildCreatorBrief(page, outreachUrl, operatorAngle, profile),
    buildPressBrief(page, outreachUrl, proofAngle, profile),
  ];

  // Pinterest pins for discovery-intent templates (guides, comparisons, costs)
  if (supportsPinterest) {
    assets.push(buildPinterestPin(page, pinterestUrl, primaryAngle, profile));
  }

  return assets;
}

export function buildDigestSection(page: DistributionPageInput) {
  const profile = buildRepurposingProfile(page);
  const pageUrl = buildTrackedUrl(profile.pageUrl, 'newsletter', 'digest_issue', page.slug);
  const primaryAngle = profile.angles[0];

  return {
    page_slug: page.slug,
    template: page.template,
    title: page.title,
    hook: trimTo(primaryAngle.hook, 120),
    bullets: [
      profile.strongestClaim,
      profile.proofPoint,
      profile.strongestObjection,
    ].slice(0, 3),
    cta_label: 'Read the full article',
    cta_url: pageUrl,
  };
}

export function buildPersonaDistributionPayloads(page: DistributionPageInput) {
  const profile = buildRepurposingProfile(page);
  const pageUrl = buildTrackedUrl(profile.pageUrl, 'newsletter', 'persona_variant', page.slug);

  return profile.personas.map((persona, index) => {
    const angle = profile.angles[index % profile.angles.length];
    return {
      persona,
      payload: {
        subject: `${page.title} for ${PERSONA_COPY[persona].label}`,
        hook: angle.hook,
        summary: page.meta_description ?? profile.proofPoint,
        cta: `Read the full guide at ${pageUrl}`,
        beat: page.metadata?.beat ?? null,
        angle_type: angle.angleType,
        claim_type: angle.claimType,
        evidence_type: angle.evidenceType,
        strongest_claim: profile.strongestClaim,
        strongest_objection: profile.strongestObjection,
        proof_point: profile.proofPoint,
        persona_hook: PERSONA_COPY[persona].hook,
        source_signals: profile.evidenceSignals.slice(0, 4),
      },
    };
  });
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
    ...extractStrings(page.body_json?.sections ?? []),
  ].join(' ').toLowerCase();

  const candidates = ['oura', 'whoop', 'ultrahuman', 'ringconn', 'samsung', 'garmin', 'volo', 'apple watch', 'galaxy ring'];
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
