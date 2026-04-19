const SMART_RING_CORE_TERMS = [
  'smart ring',
  'ring tracker',
  'fitness ring',
  'sleep ring',
  'recovery ring',
  'health ring',
  'wearable ring',
];

const SMART_RING_BRANDS = [
  'volo ring',
  'volo',
  'oura',
  'whoop',
  'ultrahuman',
  'ringconn',
  'samsung galaxy ring',
  'galaxy ring',
  'circular ring',
  'evie ring',
];

const SMART_RING_COMMERCIAL_TERMS = [
  'best',
  'vs',
  'versus',
  'alternative',
  'alternatives',
  'review',
  'reviews',
  'price',
  'pricing',
  'cost',
  'worth it',
  'buy',
  'buyer',
  'compare',
  'comparison',
  'subscription',
  'battery life',
  'accuracy',
  'size',
  'sizing',
  'compatibility',
  'integrations',
];

const SMART_RING_USE_CASE_TERMS = [
  'sleep tracking',
  'recovery',
  'hrv',
  'readiness',
  'stress',
  'athletes',
  'runners',
  'lifting',
  'strength training',
  'women',
];

export const SMART_RING_MONEY_KEYWORDS: Array<{
  keyword: string;
  templateId:
    | 'alternatives'
    | 'reviews'
    | 'costs'
    | 'compatibility'
    | 'metrics'
    | 'pillars';
  priority: number;
  clusterName: string;
}> = [
  { keyword: 'best smart ring for sleep tracking', templateId: 'alternatives', priority: 96, clusterName: 'smart-ring-comparisons' },
  { keyword: 'best smart ring for recovery tracking', templateId: 'alternatives', priority: 95, clusterName: 'smart-ring-comparisons' },
  { keyword: 'best smart ring for athletes', templateId: 'alternatives', priority: 94, clusterName: 'smart-ring-use-cases' },
  { keyword: 'best smart ring for runners', templateId: 'alternatives', priority: 92, clusterName: 'smart-ring-use-cases' },
  { keyword: 'best smart ring for strength training', templateId: 'alternatives', priority: 91, clusterName: 'smart-ring-use-cases' },
  { keyword: 'oura ring alternatives', templateId: 'alternatives', priority: 98, clusterName: 'oura-ring-alternatives' },
  { keyword: 'whoop vs oura ring', templateId: 'alternatives', priority: 97, clusterName: 'whoop-vs-oura' },
  { keyword: 'ultrahuman ring vs oura', templateId: 'alternatives', priority: 96, clusterName: 'smart-ring-comparisons' },
  { keyword: 'ringconn vs oura ring', templateId: 'alternatives', priority: 95, clusterName: 'smart-ring-comparisons' },
  { keyword: 'samsung galaxy ring vs oura', templateId: 'alternatives', priority: 94, clusterName: 'smart-ring-comparisons' },
  { keyword: 'best smart ring without subscription', templateId: 'costs', priority: 96, clusterName: 'smart-ring-pricing' },
  { keyword: 'smart ring subscription comparison', templateId: 'costs', priority: 93, clusterName: 'smart-ring-pricing' },
  { keyword: 'smart ring cost comparison', templateId: 'costs', priority: 92, clusterName: 'smart-ring-pricing' },
  { keyword: 'oura ring review', templateId: 'reviews', priority: 94, clusterName: 'oura-ring-reviews' },
  { keyword: 'ultrahuman ring review', templateId: 'reviews', priority: 93, clusterName: 'smart-ring-reviews' },
  { keyword: 'ringconn review', templateId: 'reviews', priority: 92, clusterName: 'smart-ring-reviews' },
  { keyword: 'samsung galaxy ring review', templateId: 'reviews', priority: 91, clusterName: 'smart-ring-reviews' },
  { keyword: 'smart ring sizing guide', templateId: 'compatibility', priority: 88, clusterName: 'smart-ring-compatibility' },
  { keyword: 'smart ring iphone compatibility', templateId: 'compatibility', priority: 87, clusterName: 'smart-ring-compatibility' },
  { keyword: 'smart ring android compatibility', templateId: 'compatibility', priority: 87, clusterName: 'smart-ring-compatibility' },
  { keyword: 'smart ring hrv accuracy', templateId: 'metrics', priority: 89, clusterName: 'smart-ring-metrics' },
  { keyword: 'smart ring sleep tracking accuracy', templateId: 'metrics', priority: 89, clusterName: 'smart-ring-metrics' },
  { keyword: 'smart ring battery life comparison', templateId: 'metrics', priority: 88, clusterName: 'smart-ring-metrics' },
  { keyword: 'smart ring for women health tracking', templateId: 'alternatives', priority: 88, clusterName: 'smart-ring-use-cases' },
  { keyword: 'best smart ring for android users', templateId: 'compatibility', priority: 87, clusterName: 'smart-ring-compatibility' },
  { keyword: 'best smart ring for iphone users', templateId: 'compatibility', priority: 87, clusterName: 'smart-ring-compatibility' },
  { keyword: 'smart ring size guide before you buy', templateId: 'compatibility', priority: 86, clusterName: 'smart-ring-compatibility' },
  { keyword: 'oura ring subscription cost', templateId: 'costs', priority: 90, clusterName: 'smart-ring-pricing' },
  { keyword: 'ultrahuman ring subscription cost', templateId: 'costs', priority: 88, clusterName: 'smart-ring-pricing' },
  { keyword: 'smart ring accuracy for hrv and sleep', templateId: 'metrics', priority: 88, clusterName: 'smart-ring-metrics' },
  { keyword: 'best smart ring for lifting recovery', templateId: 'alternatives', priority: 89, clusterName: 'smart-ring-use-cases' },
  { keyword: 'best smart ring for marathon training', templateId: 'alternatives', priority: 88, clusterName: 'smart-ring-use-cases' },
  { keyword: 'smart ring vs smartwatch for recovery', templateId: 'alternatives', priority: 90, clusterName: 'smart-ring-comparisons' },
  { keyword: 'volo ring vs oura', templateId: 'alternatives', priority: 94, clusterName: 'volo-ring-comparisons' },
  { keyword: 'volo ring review', templateId: 'reviews', priority: 92, clusterName: 'volo-ring-reviews' },
  { keyword: 'smart ring guide', templateId: 'pillars', priority: 85, clusterName: 'smart-ring-guide' },
];

function includesAny(lower: string, terms: string[]): string[] {
  return terms.filter((term) => lower.includes(term));
}

export function scoreSmartRingOpportunity(keyword: string) {
  const lower = keyword.toLowerCase().trim();
  const coreMatches = includesAny(lower, SMART_RING_CORE_TERMS);
  const brandMatches = includesAny(lower, SMART_RING_BRANDS);
  const commercialMatches = includesAny(lower, SMART_RING_COMMERCIAL_TERMS);
  const useCaseMatches = includesAny(lower, SMART_RING_USE_CASE_TERMS);

  const score =
    coreMatches.length * 6 +
    brandMatches.length * 5 +
    commercialMatches.length * 4 +
    useCaseMatches.length * 3;

  return {
    score,
    coreMatches,
    brandMatches,
    commercialMatches,
    useCaseMatches,
    onTopic: score >= 6 && (coreMatches.length > 0 || brandMatches.length > 0),
    stronglyCommercial: commercialMatches.length > 0,
  };
}

export function isSmartRingKeyword(keyword: string): boolean {
  return scoreSmartRingOpportunity(keyword).onTopic;
}

export function boostSmartRingPriority(keyword: string, basePriority: number): number {
  const assessment = scoreSmartRingOpportunity(keyword);
  const boosted = basePriority
    + Math.min(assessment.score, 20)
    + (assessment.stronglyCommercial ? 8 : 0)
    + (assessment.useCaseMatches.length > 0 ? 4 : 0);

  return Math.min(99, boosted);
}

const COMMERCIAL_INTENT_SIGNALS = [
  'best', 'top', 'vs', 'versus', 'alternative', 'alternatives',
  'review', 'reviews', 'compare', 'comparison', 'compared',
  'price', 'pricing', 'cost', 'costs', 'worth it', 'buy', 'buying',
  'subscription', 'no subscription', 'without subscription',
  'under $', 'budget', 'cheap', 'affordable',
  'for women', 'for men', 'for athletes', 'for runners',
  'for sleep', 'for recovery', 'for hrv', 'for beginners', 'for seniors',
  'most accurate', 'waterproof', 'battery life',
  'should i buy', 'is it worth', 'which is better',
];

const INFORMATIONAL_PENALTY_SIGNALS = [
  'what is', 'what are', 'how does', 'how do',
  'history of', 'who invented', 'definition', 'meaning',
  'explained', 'science behind', 'anatomy', 'overview of',
  'introduction to',
];

export function scoreCommercialIntent(keyword: string): number {
  const lower = keyword.toLowerCase().trim();
  let score = 50;
  for (const signal of COMMERCIAL_INTENT_SIGNALS) {
    if (lower.includes(signal)) score += 10;
  }
  for (const signal of INFORMATIONAL_PENALTY_SIGNALS) {
    if (lower.includes(signal)) score -= 25;
  }
  return Math.max(0, Math.min(100, score));
}

export function buildSmartRingTemplateCopy(
  templateId: string,
  term: string,
): { title: string; h1: string; meta: string } | null {
  if (!isSmartRingKeyword(term)) return null;

  if (templateId === 'comparison' || templateId === 'alternatives') {
    return {
      title: `${term}: best smart ring options, tradeoffs, and who should buy`,
      h1: `${term}: smart ring comparison and tradeoffs`,
      meta: `Compare ${term} with a buyer-first breakdown of accuracy, subscription costs, comfort, battery life, and recovery features.`,
    };
  }

  if (templateId === 'reviews') {
    return {
      title: `${term}: smart ring review, strengths, limits, and buyer fit`,
      h1: `${term}: smart ring review`,
      meta: `Read a practical ${term} review covering sleep tracking, recovery data, sizing, battery life, app quality, and whether it is worth buying.`,
    };
  }

  if (templateId === 'costs') {
    return {
      title: `${term}: smart ring pricing, subscription costs, and value`,
      h1: `${term}: smart ring pricing and value`,
      meta: `Break down ${term} pricing, ongoing subscription costs, and whether the features justify the spend for recovery tracking.`,
    };
  }

  if (templateId === 'compatibility') {
    return {
      title: `${term}: smart ring compatibility, setup, and device support`,
      h1: `${term}: smart ring compatibility and setup`,
      meta: `Check ${term} compatibility with iPhone, Android, apps, sizing, and daily-use setup requirements before you buy.`,
    };
  }

  if (templateId === 'metrics') {
    return {
      title: `${term}: smart ring accuracy, metrics, and interpretation`,
      h1: `${term}: smart ring metrics and accuracy`,
      meta: `Understand ${term}, what the ring is actually measuring, and how useful those metrics are for sleep, HRV, and recovery decisions.`,
    };
  }

  if (templateId === 'pillars') {
    return {
      title: `${term}: complete smart ring buying guide`,
      h1: `${term}: complete smart ring guide`,
      meta: `A complete smart ring guide covering top devices, tradeoffs, accuracy, subscriptions, use cases, and how to choose the right wearable.`,
    };
  }

  return {
    title: `${term}: smart ring guide for sleep, recovery, and performance`,
    h1: `${term}: smart ring guide`,
    meta: `Evidence-first guide to ${term} with practical buying context for sleep tracking, recovery monitoring, and daily wearable use.`,
  };
}
