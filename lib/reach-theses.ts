export type ReachThesis = {
  slug: string;
  title: string;
  thesis: string;
  supportingFrames: string[];
  triggerTerms: string[];
};

export const CORE_REACH_THESES: ReachThesis[] = [
  {
    slug: 'subscription-burden-beats-feature-count',
    title: 'Subscription Burden Beats Feature Count',
    thesis: 'Subscription burden matters more than feature count in smart-ring buying decisions.',
    supportingFrames: [
      'Year-one cost beats sticker price.',
      'Lock-in risk matters more than one extra metric.',
      'Feature access is not the same as buyer value.',
    ],
    triggerTerms: ['subscription', 'cost', 'price', 'fee', 'pricing', 'oura alternatives'],
  },
  {
    slug: 'comfort-beats-sensor-hype',
    title: 'Comfort Beats Sensor Hype',
    thesis: 'A ring that is not comfortable overnight is not a serious sleep or recovery product.',
    supportingFrames: [
      'Adherence is the real moat.',
      'Wearability determines whether the data exists at all.',
      'Comfort compounds into signal quality.',
    ],
    triggerTerms: ['sleep', 'comfort', 'overnight', 'fit', 'sizing'],
  },
  {
    slug: 'buyer-fit-beats-brand-halo',
    title: 'Buyer Fit Beats Brand Halo',
    thesis: 'The best ring is usually the best fit for the buyer, not the most famous brand.',
    supportingFrames: [
      'Best for and avoid if matter more than generic rankings.',
      'Use case split is better than brand worship.',
      'Shortlists should be persona-specific.',
    ],
    triggerTerms: ['best', 'review', 'vs', 'compare', 'alternatives', 'buyers'],
  },
  {
    slug: 'signal-quality-needs-context',
    title: 'Signal Quality Needs Context',
    thesis: 'Most recovery metrics are less useful than marketing implies unless the signal quality and context are clear.',
    supportingFrames: [
      'Validation beats feature lists.',
      'Useful inference is not the same as scientific certainty.',
      'Methodology should travel with the claim.',
    ],
    triggerTerms: ['accuracy', 'hrv', 'validated', 'sensor', 'metric', 'temperature'],
  },
  {
    slug: 'buyer-clarity-beats-spec-overload',
    title: 'Buyer Clarity Beats Spec Overload',
    thesis: 'People remember brands that simplify the decision, not brands that repeat the spec sheet.',
    supportingFrames: [
      'Decision clarity creates reach.',
      'Verdict-first content travels further.',
      'The market rewards simple, repeatable frameworks.',
    ],
    triggerTerms: ['guide', 'what is', 'worth it', 'buy', 'decision', 'smart ring'],
  },
];

export function pickReachThesis(input: { title?: string | null; primaryKeyword?: string | null; template?: string | null; body?: string | null }) {
  const haystack = `${input.title ?? ''} ${input.primaryKeyword ?? ''} ${input.template ?? ''} ${input.body ?? ''}`.toLowerCase();
  const scored = CORE_REACH_THESES.map((thesis) => ({
    thesis,
    score: thesis.triggerTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);

  return scored[0]?.score ? scored[0].thesis : CORE_REACH_THESES[0];
}
