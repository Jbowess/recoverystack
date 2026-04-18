import { PRODUCT_NAME, PRODUCT_DESTINATION_URL } from '@/lib/brand';

export const AUDIENCE_SEGMENT_SEEDS = [
  {
    slug: 'runners',
    label: 'Runners',
    description: 'Endurance and hybrid athletes who care about sleep quality, readiness, and recovery trend lines.',
    buyer_traits: ['training-load aware', 'sleep-sensitive', 'reads comparisons'],
    keywords: ['best smart ring for runners', 'hrv for running', 'readiness score for marathon training'],
    preferred_ctas: ['compare rings', 'see recovery features', 'join training brief'],
    content_angles: ['battery and comfort', 'sleep signal quality', 'training readiness'],
  },
  {
    slug: 'lifters',
    label: 'Lifters',
    description: 'Strength-focused buyers evaluating recovery insights without wanting a screen-heavy smartwatch.',
    buyer_traits: ['strength-focused', 'subscription-sensitive', 'practical buyers'],
    keywords: ['best smart ring for strength training', 'smart ring for lifters', 'readiness score lifting'],
    preferred_ctas: ['see product fit', 'compare to Oura', 'download buyer guide'],
    content_angles: ['comfort under daily wear', 'sleep and strain interpretation', 'subscription tradeoffs'],
  },
  {
    slug: 'sleep-buyers',
    label: 'Sleep-Focused Buyers',
    description: 'People mainly buying for sleep tracking, nightly comfort, and long-term habit feedback.',
    buyer_traits: ['sleep-first', 'data-aware', 'non-athlete possible'],
    keywords: ['best smart ring for sleep tracking', 'smart ring sleep accuracy', 'oura alternatives for sleep'],
    preferred_ctas: ['view sleep guide', 'compare sleep accuracy', 'join weekly brief'],
    content_angles: ['sleep stage accuracy', 'overnight comfort', 'subscription burden'],
  },
  {
    slug: 'subscription-averse',
    label: 'Subscription-Averse Buyers',
    description: 'Buyers comparing total cost of ownership and avoiding monthly platform lock-in.',
    buyer_traits: ['price sensitive', 'comparison driven', 'long-term value focused'],
    keywords: ['best smart ring without subscription', 'smart ring cost comparison', 'oura alternatives'],
    preferred_ctas: ['compare costs', 'view pricing', 'download cost sheet'],
    content_angles: ['upfront cost vs TCO', 'subscription caveats', 'feature access'],
  },
  {
    slug: 'accuracy-first',
    label: 'Accuracy-First Buyers',
    description: 'Research-heavy buyers who care about validation, methodology, and signal quality.',
    buyer_traits: ['evidence oriented', 'review heavy', 'skeptical'],
    keywords: ['smart ring accuracy', 'smart ring HRV accuracy', 'sleep tracking validation'],
    preferred_ctas: ['see methodology', 'compare accuracy', 'read evidence review'],
    content_angles: ['testing methodology', 'limitations', 'claim confidence'],
  },
];

export const BRAND_VOICE_SEEDS = [
  {
    slug: 'recoverystack-core-voice',
    label: 'RecoveryStack Core Voice',
    tone_rules: ['be direct', 'be buyer-first', 'favor tradeoffs over hype', 'state what is unknown'],
    banned_phrases: ['game-changer', 'revolutionary', 'groundbreaking', 'ultimate', 'best ever'],
    required_frames: ['who it is for', 'who it is not for', 'what matters before buying', 'subscription disclosure where relevant'],
    example_lines: [
      'The real question is not whether the metric exists, but whether it changes a buying decision.',
      'Most wearable copy overstates certainty. We prefer to separate measured facts from useful inference.',
    ],
  },
  {
    slug: 'smart-ring-commercial-voice',
    label: 'Smart Ring Commercial Voice',
    tone_rules: ['comparison-led', 'price-transparent', 'anti-fluff'],
    banned_phrases: ['transform your life overnight', 'biohack your body', 'unlock peak human performance'],
    required_frames: ['cost of ownership', 'battery reality', 'sleep comfort', 'platform compatibility'],
    example_lines: [
      'If subscription cost matters to you, that should shape the shortlist before feature details do.',
      'A ring that is uncomfortable overnight is not a sleep product, regardless of the spec sheet.',
    ],
  },
];

export const AUTOMATION_POLICY_SEEDS = [
  {
    policy_key: 'publish_quality_floor',
    label: 'Publish quality floor',
    policy_type: 'publish_guard',
    enabled: true,
    severity: 'high',
    config: { min_quality_score: 75, require_review_methodology_for: ['reviews', 'alternatives', 'costs'] },
  },
  {
    policy_key: 'duplicate_keyword_guard',
    label: 'Duplicate keyword guard',
    policy_type: 'queue_guard',
    enabled: true,
    severity: 'high',
    config: { prevent_duplicate_primary_keyword: true, allow_if_funnel_stage_differs: false },
  },
  {
    policy_key: 'retry_failed_growth_jobs',
    label: 'Retry failed growth jobs',
    policy_type: 'retry_policy',
    enabled: true,
    severity: 'medium',
    config: { max_retries: 3, retry_window_minutes: 30 },
  },
];

export const LEAD_MAGNET_SEEDS = [
  {
    slug: 'smart-ring-buyer-brief',
    title: 'Smart Ring Buyer Brief',
    format: 'pdf',
    target_segment: 'subscription-averse',
    primary_cta: 'Get the 2026 smart ring buyer brief',
    destination_url: `${PRODUCT_DESTINATION_URL}?lead=buyer-brief`,
    metadata: { theme: 'comparison', pages: 12 },
  },
  {
    slug: 'recovery-score-playbook',
    title: 'Recovery Score Playbook',
    format: 'email_course',
    target_segment: 'runners',
    primary_cta: 'Get the recovery score playbook',
    destination_url: `${PRODUCT_DESTINATION_URL}?lead=recovery-playbook`,
    metadata: { lessons: 5 },
  },
  {
    slug: 'smart-ring-cost-sheet',
    title: 'Smart Ring Cost Sheet',
    format: 'spreadsheet',
    target_segment: 'subscription-averse',
    primary_cta: 'Get the smart ring cost sheet',
    destination_url: `${PRODUCT_DESTINATION_URL}?lead=cost-sheet`,
    metadata: { category: 'pricing' },
  },
];

export const CREATOR_RELATIONSHIP_SEEDS = [
  {
    slug: 'dc-rainmaker',
    name: 'DC Rainmaker',
    primary_platform: 'blog',
    handle: '@dcrainmakerblog',
    audience_segment: 'accuracy-first',
    relevance_score: 96,
    partnership_fit: 'review amplification and buyer-intent trust transfer',
  },
  {
    slug: 'quantified-scientist',
    name: 'The Quantified Scientist',
    primary_platform: 'youtube',
    handle: '@TheQuantifiedScientist',
    audience_segment: 'accuracy-first',
    relevance_score: 95,
    partnership_fit: 'accuracy-first audience and validation framing',
  },
  {
    slug: 'wearable-creators-pool',
    name: 'Wearable creators pool',
    primary_platform: 'instagram',
    handle: null,
    audience_segment: 'sleep-buyers',
    relevance_score: 78,
    partnership_fit: 'short-form social distribution and affiliate seeding',
  },
];

export const PRODUCT_INTELLIGENCE_CARDS = [
  {
    product_slug: 'volo-ring',
    card_type: 'faq',
    title: 'Sizing expectations',
    body: 'Explain ring sizing clearly, including how fit affects overnight comfort and sensor consistency.',
  },
  {
    product_slug: 'volo-ring',
    card_type: 'faq',
    title: 'Battery caveats',
    body: 'State expected battery range and the conditions that reduce battery life instead of only quoting best-case numbers.',
  },
  {
    product_slug: 'volo-ring',
    card_type: 'objection',
    title: 'Is a ring enough without a watch?',
    body: 'Answer whether buyers who want training metrics, recovery signals, and all-day comfort still need a watch.',
  },
  {
    product_slug: 'volo-ring',
    card_type: 'comparison_edge',
    title: 'Subscription-free value framing',
    body: `Whenever comparing against subscription products, explain the total cost of ownership and where ${PRODUCT_NAME} fits.`,
  },
];

export function inferAudienceSegment(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes('runner') || lower.includes('marathon')) return 'runners';
  if (lower.includes('strength') || lower.includes('lift')) return 'lifters';
  if (lower.includes('sleep')) return 'sleep-buyers';
  if (lower.includes('subscription') || lower.includes('cost')) return 'subscription-averse';
  if (lower.includes('accuracy') || lower.includes('validation')) return 'accuracy-first';
  return 'sleep-buyers';
}

export function buildLeadMagnetOffer(segment: string) {
  return LEAD_MAGNET_SEEDS.find((offer) => offer.target_segment === segment) ?? LEAD_MAGNET_SEEDS[0];
}

export function buildBuyerQuizResult(input: {
  priority: 'sleep' | 'cost' | 'accuracy' | 'training';
  hatesSubscription: boolean;
  prefersNoScreen: boolean;
}) {
  const segment =
    input.priority === 'training'
      ? 'runners'
      : input.priority === 'cost'
        ? 'subscription-averse'
        : input.priority === 'accuracy'
          ? 'accuracy-first'
          : 'sleep-buyers';

  const recommendation =
    input.hatesSubscription
      ? `${PRODUCT_NAME} is likely a stronger fit if avoiding monthly fees matters.`
      : input.prefersNoScreen
        ? `${PRODUCT_NAME} fits buyers who want overnight comfort and less device friction.`
        : `${PRODUCT_NAME} should be compared directly against Oura and RingConn for your use case.`;

  const nextStep = buildLeadMagnetOffer(segment);
  return { segment, recommendation, nextStep };
}
