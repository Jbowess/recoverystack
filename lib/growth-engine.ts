import { PRODUCT_DESTINATION_URL, PRODUCT_NAME } from '@/lib/brand';

export type PartnerContactSeed = {
  slug: string;
  name: string;
  targetType: 'brand' | 'creator' | 'affiliate_network' | 'press' | 'community' | 'retailer';
  domain: string | null;
  websiteUrl: string | null;
  primaryChannel: string | null;
  contactEmail: string | null;
  socialHandle: string | null;
  audienceFit: string;
  niches: string[];
  partnershipAngles: string[];
  priority: number;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export type EditorialTrustSeed = {
  slug: string;
  label: string;
  profileType: 'methodology' | 'review_standard' | 'reviewer_profile' | 'evidence_standard';
  appliesToTemplates: string[];
  evidenceRequirements: string[];
  reviewSteps: string[];
  trustSignals: string[];
  metadata?: Record<string, unknown>;
};

export type GrowthRoadmapSeed = {
  slug: string;
  title: string;
  primaryKeyword: string;
  template: string;
  intent: 'commercial' | 'transactional' | 'informational';
  funnelStage: 'awareness' | 'consideration' | 'decision';
  clusterName: string;
  priority: number;
  notes: string;
  metadata?: Record<string, unknown>;
};

export type ProductTruthSeed = {
  productSlug: string;
  cardType: 'positioning' | 'faq' | 'objection' | 'use_case' | 'claim' | 'comparison_edge';
  title: string;
  body: string;
  priority: number;
  metadata?: Record<string, unknown>;
};

export type DistributionAssetRow = {
  id: string;
  page_id: string | null;
  page_slug: string;
  channel: string;
  asset_type: string;
  title: string | null;
  hook: string | null;
  summary: string | null;
  body: string | null;
  cta_url: string | null;
  payload?: Record<string, unknown> | null;
};

export const PARTNER_CONTACT_SEEDS: PartnerContactSeed[] = [
  {
    slug: 'oura-editorial',
    name: 'Oura editorial / partnerships',
    targetType: 'brand',
    domain: 'ouraring.com',
    websiteUrl: 'https://ouraring.com',
    primaryChannel: 'email',
    contactEmail: null,
    socialHandle: '@ouraring',
    audienceFit: 'smart-ring buyers comparing subscription, sleep accuracy, and readiness scoring',
    niches: ['smart_ring', 'sleep_tracking', 'recovery_wearables'],
    partnershipAngles: ['comparison_coverage', 'co-marketing', 'competitor_response'],
    priority: 92,
  },
  {
    slug: 'ringconn-editorial',
    name: 'RingConn growth / partnerships',
    targetType: 'brand',
    domain: 'ringconn.com',
    websiteUrl: 'https://ringconn.com',
    primaryChannel: 'email',
    contactEmail: null,
    socialHandle: '@ringconn',
    audienceFit: 'price-conscious buyers comparing battery life and no-subscription models',
    niches: ['smart_ring', 'wearable_comparisons'],
    partnershipAngles: ['comparison_coverage', 'affiliate_outreach'],
    priority: 90,
  },
  {
    slug: 'ultrahuman-editorial',
    name: 'Ultrahuman editor / partner team',
    targetType: 'brand',
    domain: 'ultrahuman.com',
    websiteUrl: 'https://www.ultrahuman.com',
    primaryChannel: 'email',
    contactEmail: null,
    socialHandle: '@ultrahumanhq',
    audienceFit: 'buyers looking at metabolic health plus ring hardware',
    niches: ['smart_ring', 'wearables', 'metabolic_health'],
    partnershipAngles: ['comparison_coverage', 'launch_roundup'],
    priority: 87,
  },
  {
    slug: 'dc-rainmaker',
    name: 'DC Rainmaker',
    targetType: 'creator',
    domain: 'dcrainmaker.com',
    websiteUrl: 'https://www.dcrainmaker.com',
    primaryChannel: 'email',
    contactEmail: null,
    socialHandle: '@dcrainmakerblog',
    audienceFit: 'high-intent endurance and wearable buyers who trust long-form reviews',
    niches: ['wearables', 'smart_ring', 'sports_tech'],
    partnershipAngles: ['review_roundup', 'creator_outreach', 'affiliate_outreach'],
    priority: 96,
  },
  {
    slug: 'the-quantified-scientist',
    name: 'The Quantified Scientist',
    targetType: 'creator',
    domain: 'thequantifiedscientist.com',
    websiteUrl: 'https://www.youtube.com/@TheQuantifiedScientist',
    primaryChannel: 'youtube',
    contactEmail: null,
    socialHandle: '@TheQuantifiedScientist',
    audienceFit: 'accuracy-driven wearable buyers who respond to testing methodology',
    niches: ['smart_ring', 'wearable_accuracy', 'sleep_tracking'],
    partnershipAngles: ['accuracy_roundup', 'review_roundup', 'research_reference'],
    priority: 95,
  },
  {
    slug: 'wareable',
    name: 'Wareable editorial',
    targetType: 'press',
    domain: 'wareable.com',
    websiteUrl: 'https://www.wareable.com',
    primaryChannel: 'email',
    contactEmail: null,
    socialHandle: '@Wareable',
    audienceFit: 'broad consumer wearable press with comparison appetite',
    niches: ['wearables', 'smart_ring', 'fitness_tech'],
    partnershipAngles: ['press_pitch', 'industry_update'],
    priority: 88,
  },
  {
    slug: 'wellness-tech-review',
    name: 'Wellness tech review creators',
    targetType: 'creator',
    domain: null,
    websiteUrl: null,
    primaryChannel: 'instagram',
    contactEmail: null,
    socialHandle: null,
    audienceFit: 'creator shortlist for short-form wearable explainers',
    niches: ['smart_ring', 'recovery_wearables', 'fitness_tech'],
    partnershipAngles: ['creator_outreach', 'ugc_whitelist', 'affiliate_outreach'],
    priority: 82,
    metadata: { generic_pool: true },
  },
  {
    slug: 'impact-network',
    name: 'Impact affiliate network',
    targetType: 'affiliate_network',
    domain: 'impact.com',
    websiteUrl: 'https://impact.com',
    primaryChannel: 'portal',
    contactEmail: null,
    socialHandle: null,
    audienceFit: 'affiliate infrastructure for wearable and DTC partnerships',
    niches: ['affiliate', 'wearables', 'consumer_hardware'],
    partnershipAngles: ['affiliate_outreach', 'partner_enablement'],
    priority: 80,
  },
  {
    slug: 'reddit-biohackers',
    name: 'r/Biohackers community map',
    targetType: 'community',
    domain: 'reddit.com',
    websiteUrl: 'https://www.reddit.com/r/Biohackers/',
    primaryChannel: 'reddit',
    contactEmail: null,
    socialHandle: 'r/Biohackers',
    audienceFit: 'early adopter wearable community with tolerance for evidence-heavy discussion',
    niches: ['biohacking', 'smart_ring', 'sleep_tracking'],
    partnershipAngles: ['community_discussion', 'ama', 'research_roundup'],
    priority: 78,
  },
];

export const EDITORIAL_TRUST_SEEDS: EditorialTrustSeed[] = [
  {
    slug: 'smart-ring-review-standard',
    label: 'Smart ring review standard',
    profileType: 'review_standard',
    appliesToTemplates: ['reviews', 'alternatives', 'costs', 'compatibility'],
    evidenceRequirements: ['spec verification', 'pricing verification', 'subscription disclosure', 'competitor comparison logic'],
    reviewSteps: ['verify specs against product truth', 'state tradeoffs clearly', 'disclose unknowns', 'attach reviewer and update date'],
    trustSignals: ['named reviewer', 'testing notes', 'pricing date stamp', 'comparison rationale'],
  },
  {
    slug: 'wearable-methodology',
    label: 'Wearable testing methodology',
    profileType: 'methodology',
    appliesToTemplates: ['reviews', 'alternatives', 'metrics'],
    evidenceRequirements: ['sensor validation context', 'reference device baseline', 'real-world use-case coverage'],
    reviewSteps: ['compare claims vs use cases', 'note population fit', 'separate measured facts from inference'],
    trustSignals: ['methodology block', 'evidence grade', 'limitations callout'],
  },
  {
    slug: 'recovery-evidence-standard',
    label: 'Recovery evidence standard',
    profileType: 'evidence_standard',
    appliesToTemplates: ['guides', 'metrics', 'protocols', 'news'],
    evidenceRequirements: ['primary source reference', 'study-quality qualifier', 'mechanism caveat'],
    reviewSteps: ['label certainty', 'avoid medical overclaiming', 'surface contradictions when present'],
    trustSignals: ['evidence labels', 'reviewed byline', 'last verified date'],
  },
];

const SMART_RING_COMMERCIAL_CLUSTER_ROWS: Array<[string, string, string, string, GrowthRoadmapSeed['funnelStage'], number]> = [
  ['volo-ring-review', 'Volo Ring review', 'volo ring review', 'reviews', 'decision', 98],
  ['volo-ring-vs-oura', 'Volo Ring vs Oura Ring', 'volo ring vs oura ring', 'alternatives', 'decision', 97],
  ['volo-ring-vs-ringconn', 'Volo Ring vs RingConn', 'volo ring vs ringconn', 'alternatives', 'decision', 95],
  ['best-smart-ring-for-recovery', 'Best smart ring for recovery', 'best smart ring for recovery', 'alternatives', 'decision', 96],
  ['best-smart-ring-for-runners', 'Best smart ring for runners', 'best smart ring for runners', 'alternatives', 'consideration', 92],
  ['best-smart-ring-for-strength-training', 'Best smart ring for strength training', 'best smart ring for strength training', 'alternatives', 'consideration', 90],
  ['smart-ring-cost-comparison', 'Smart ring cost comparison', 'smart ring cost comparison', 'costs', 'decision', 94],
  ['smart-ring-subscription-comparison', 'Smart ring subscription comparison', 'smart ring subscription comparison', 'costs', 'decision', 93],
  ['oura-ring-review', 'Oura Ring review', 'oura ring review', 'reviews', 'decision', 95],
  ['ringconn-review', 'RingConn review', 'ringconn review', 'reviews', 'decision', 91],
  ['ultrahuman-ring-review', 'Ultrahuman Ring review', 'ultrahuman ring review', 'reviews', 'decision', 90],
  ['smart-ring-accuracy-explained', 'How accurate are smart rings?', 'smart ring accuracy', 'guides', 'consideration', 89],
  ['smart-ring-hrv-accuracy', 'Smart ring HRV accuracy', 'smart ring hrv accuracy', 'metrics', 'consideration', 88],
  ['smart-ring-sleep-tracking-accuracy', 'Smart ring sleep tracking accuracy', 'smart ring sleep tracking accuracy', 'metrics', 'consideration', 88],
  ['best-smart-ring-no-subscription', 'Best smart ring without subscription', 'best smart ring without subscription', 'alternatives', 'decision', 94],
  ['best-smart-ring-for-women', 'Best smart ring for women', 'best smart ring for women', 'alternatives', 'consideration', 84],
  ['best-smart-ring-for-men', 'Best smart ring for men', 'best smart ring for men', 'alternatives', 'consideration', 82],
  ['best-smart-ring-for-athletes', 'Best smart ring for athletes', 'best smart ring for athletes', 'alternatives', 'decision', 91],
  ['smart-ring-size-guide', 'Smart ring sizing guide', 'smart ring sizing guide', 'guides', 'decision', 87],
  ['smart-ring-iphone-compatibility', 'Smart ring iPhone compatibility', 'smart ring iphone compatibility', 'compatibility', 'decision', 83],
  ['smart-ring-android-compatibility', 'Smart ring Android compatibility', 'smart ring android compatibility', 'compatibility', 'decision', 83],
  ['who-should-buy-a-smart-ring', 'Who should buy a smart ring?', 'who should buy a smart ring', 'guides', 'consideration', 80],
  ['oura-alternatives', 'Best Oura alternatives', 'oura alternatives', 'alternatives', 'decision', 95],
  ['ringconn-vs-oura-ring', 'RingConn vs Oura Ring', 'ringconn vs oura ring', 'alternatives', 'decision', 96],
  ['ultrahuman-vs-oura-ring', 'Ultrahuman Ring vs Oura Ring', 'ultrahuman ring vs oura ring', 'alternatives', 'decision', 90],
  ['best-smart-ring-for-sleep', 'Best smart ring for sleep tracking', 'best smart ring for sleep tracking', 'alternatives', 'consideration', 90],
  ['best-smart-ring-battery-life', 'Best smart ring battery life', 'best smart ring battery life', 'alternatives', 'consideration', 84],
  ['smart-ring-waterproof-guide', 'Are smart rings waterproof?', 'are smart rings waterproof', 'guides', 'consideration', 78],
  ['smart-ring-vs-watch', 'Smart ring vs smartwatch', 'smart ring vs smartwatch', 'alternatives', 'consideration', 89],
  ['smart-ring-readiness-score', 'How smart ring readiness scores work', 'smart ring readiness score', 'metrics', 'awareness', 81],
  ['smart-ring-recovery-score', 'How smart ring recovery scores work', 'smart ring recovery score', 'metrics', 'awareness', 81],
  ['smart-ring-temperature-tracking', 'Smart ring temperature tracking explained', 'smart ring temperature tracking', 'metrics', 'awareness', 76],
  ['smart-ring-spo2-tracking', 'Smart ring SpO2 tracking explained', 'smart ring spo2 tracking', 'metrics', 'awareness', 74],
  ['volo-ring-price', 'Volo Ring price and subscription', 'volo ring price', 'costs', 'decision', 97],
  ['volo-ring-sizing', 'Volo Ring sizing and fit guide', 'volo ring sizing', 'guides', 'decision', 88],
  ['volo-ring-compatibility', 'Volo Ring compatibility', 'volo ring compatibility', 'compatibility', 'decision', 89],
  ['volo-ring-battery-life', 'Volo Ring battery life', 'volo ring battery life', 'reviews', 'decision', 86],
  ['volo-ring-accuracy', 'Volo Ring accuracy', 'volo ring accuracy', 'reviews', 'decision', 85],
  ['volo-ring-for-runners', 'Volo Ring for runners', 'volo ring for runners', 'guides', 'decision', 82],
  ['volo-ring-for-lifters', 'Volo Ring for lifters', 'volo ring for lifters', 'guides', 'decision', 81],
];

export const SMART_RING_COMMERCIAL_CLUSTER: GrowthRoadmapSeed[] = SMART_RING_COMMERCIAL_CLUSTER_ROWS.map(([slug, title, keyword, template, funnelStage, priority]) => ({
  slug,
  title,
  primaryKeyword: keyword,
  template,
  intent: ['guides', 'metrics'].includes(template) ? 'informational' : 'commercial',
  funnelStage,
  clusterName: 'smart-ring-commercial-engine',
  priority,
  notes: 'Curated smart-ring commercial cluster for RecoveryStack growth.',
  metadata: {
    market_focus: 'smart_ring',
    product_line: PRODUCT_NAME,
  },
}));

export const PRODUCT_TRUTH_SEEDS: ProductTruthSeed[] = [
  {
    productSlug: 'volo-ring',
    cardType: 'positioning',
    title: 'Recovery-first positioning',
    body: `${PRODUCT_NAME} is positioned around sleep, readiness, HRV, and recovery workflows rather than generic step-counting.`,
    priority: 100,
  },
  {
    productSlug: 'volo-ring',
    cardType: 'comparison_edge',
    title: 'No mandatory subscription angle',
    body: `${PRODUCT_NAME} should be framed clearly against recurring-subscription competitors whenever pricing pages are generated.`,
    priority: 95,
    metadata: { requires_verification: true },
  },
  {
    productSlug: 'volo-ring',
    cardType: 'use_case',
    title: 'Built for athletes and recovery-focused buyers',
    body: `${PRODUCT_NAME} should be matched to runners, lifters, hybrids, and people who care about training readiness more than smartwatch notifications.`,
    priority: 92,
  },
  {
    productSlug: 'volo-ring',
    cardType: 'faq',
    title: 'What does Volo Ring track?',
    body: 'Core tracked areas include sleep, HRV, resting heart rate, readiness, SpO2, and skin temperature.',
    priority: 90,
  },
  {
    productSlug: 'volo-ring',
    cardType: 'objection',
    title: 'Why buy a ring instead of a watch?',
    body: 'The answer should focus on comfort, sleep wearability, signal quality during sleep, and buyers who do not want wrist-based screens.',
    priority: 88,
  },
  {
    productSlug: 'volo-ring',
    cardType: 'claim',
    title: 'Claims must stay scoped',
    body: 'Generated content must avoid implying diagnosis, guaranteed performance outcomes, or medical equivalence.',
    priority: 98,
    metadata: { compliance: 'ymyl_guardrail' },
  },
];

export function normalizeDomain(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function extractMentionTokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

export function matchPartnerContact(
  page: { title?: string | null; primary_keyword?: string | null; meta_description?: string | null; template?: string | null },
  contacts: PartnerContactSeed[],
) {
  const haystack = `${page.title ?? ''} ${page.primary_keyword ?? ''} ${page.meta_description ?? ''}`.trim();
  const tokens = extractMentionTokens(haystack);
  const template = page.template ?? '';

  return contacts
    .map((contact) => {
      let score = contact.priority;
      if (contact.domain && tokens.has(contact.domain.split('.')[0])) score += 18;
      if (contact.name.toLowerCase().split(/[^a-z0-9]+/).some((part) => tokens.has(part))) score += 12;
      if (contact.niches.some((niche) => haystack.toLowerCase().includes(niche.replace(/_/g, ' ')))) score += 10;
      if (template === 'news' && contact.targetType === 'press') score += 8;
      if (['alternatives', 'reviews', 'costs'].includes(template) && ['brand', 'creator', 'affiliate_network'].includes(contact.targetType)) score += 8;
      return { contact, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function buildPublicationQueueRecord(asset: DistributionAssetRow) {
  const channel = asset.channel;
  const base = new Date();
  const schedule = new Date(base.getTime());
  let publishPriority = 55;
  let approvalRequired = true;
  let targetCommunity: string | null = null;
  let targetAccount: string | null = null;

  if (channel === 'x') {
    schedule.setHours(18, 0, 0, 0);
    publishPriority = 78;
    targetAccount = '@recoverystack';
  } else if (channel === 'linkedin') {
    schedule.setHours(9, 15, 0, 0);
    publishPriority = 82;
    targetAccount = 'RecoveryStack';
  } else if (channel === 'instagram') {
    schedule.setHours(19, 30, 0, 0);
    publishPriority = 74;
    targetAccount = '@recoverystack';
  } else if (channel === 'facebook') {
    schedule.setHours(13, 0, 0, 0);
    publishPriority = 58;
    targetAccount = 'RecoveryStack';
  } else if (channel === 'reddit') {
    schedule.setHours(20, 30, 0, 0);
    publishPriority = 63;
    approvalRequired = true;
    const subreddits = Array.isArray(asset.payload?.subreddit_candidates)
      ? (asset.payload?.subreddit_candidates as string[])
      : [];
    targetCommunity = subreddits[0] ? `r/${subreddits[0].replace(/^r\//, '')}` : 'r/Biohackers';
  } else if (channel === 'short_video') {
    schedule.setHours(20, 0, 0, 0);
    publishPriority = 72;
    targetAccount = '@recoverystack';
  } else if (channel === 'newsletter') {
    schedule.setHours(8, 30, 0, 0);
    publishPriority = 85;
    approvalRequired = false;
    targetAccount = 'RecoveryStack News';
  } else if (channel === 'affiliate_outreach') {
    schedule.setHours(10, 0, 0, 0);
    publishPriority = 80;
    targetAccount = PRODUCT_DESTINATION_URL;
  }

  const payload = {
    hook: asset.hook,
    summary: asset.summary,
    asset_type: asset.asset_type,
    publish_window_local: schedule.toISOString(),
    recommended_goal: ['newsletter', 'affiliate_outreach'].includes(channel) ? 'conversion' : 'reach',
  };

  return {
    distribution_asset_id: asset.id,
    page_id: asset.page_id,
    page_slug: asset.page_slug,
    channel,
    publish_status: 'pending_approval',
    publish_priority: publishPriority,
    scheduled_for: schedule.toISOString(),
    target_account: targetAccount,
    target_community: targetCommunity,
    approval_required: approvalRequired,
    body: asset.body ?? asset.summary ?? asset.title ?? asset.page_slug,
    asset_title: asset.title,
    link_url: asset.cta_url,
    platform_payload: payload,
  };
}

export function buildEditorialTrustMetadata(page: {
  slug: string;
  template: string;
  primary_keyword?: string | null;
  metadata?: Record<string, unknown> | null;
  body_json?: Record<string, unknown> | null;
}) {
  const primaryKeyword = `${page.primary_keyword ?? ''}`.toLowerCase();
  const template = page.template;
  const requiresReviewer = ['reviews', 'alternatives', 'costs', 'compatibility', 'metrics', 'news'].includes(template);
  const trustProfileSlug = template === 'news'
    ? 'recovery-evidence-standard'
    : ['reviews', 'alternatives', 'costs', 'compatibility'].includes(template)
      ? 'smart-ring-review-standard'
      : 'wearable-methodology';

  const evidenceLabel = primaryKeyword.includes('accuracy') || primaryKeyword.includes('sleep')
    ? 'high-evidence-needed'
    : 'commercial-comparison';

  return {
    ...page.metadata,
    market_focus: 'smart_ring',
    trust_profile_slug: trustProfileSlug,
    trust_needs_reviewer: requiresReviewer,
    evidence_label: evidenceLabel,
    last_trust_refresh_at: new Date().toISOString(),
    methodology_present: Boolean((page.body_json as any)?.review_methodology),
  };
}
