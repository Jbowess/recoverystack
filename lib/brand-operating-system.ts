import { createHash } from 'node:crypto';

type JsonObject = Record<string, unknown>;

export type BrandMemoryInput = {
  sourceType: string;
  sourceKey: string;
  title?: string | null;
  body: string;
  tags?: string[];
  memoryType: 'thesis' | 'claim' | 'objection' | 'hook' | 'proof' | 'relationship' | 'campaign_learning' | 'persona_signal';
  priority?: number;
  confidenceScore?: number;
  freshnessScore?: number;
  metadata?: JsonObject;
};

export type ShareOfVoiceInput = {
  marketSlug: string;
  topicSlug: string;
  channel: string;
  visibility: number;
  engagement: number;
  conversion: number;
  authority: number;
  competitorPressure: number;
  metadata?: JsonObject;
};

export type InfluenceNodeInput = {
  nodeKey: string;
  nodeType: 'creator' | 'journalist' | 'community' | 'brand' | 'partner' | 'publication' | 'channel';
  label: string;
  domain?: string | null;
  platform?: string | null;
  audienceSegment?: string | null;
  influenceScore: number;
  relationshipScore: number;
  amplificationScore: number;
  metadata?: JsonObject;
};

export type InfluenceEdgeInput = {
  sourceNodeKey: string;
  targetNodeKey: string;
  edgeType: 'audience_overlap' | 'distribution_fit' | 'relationship' | 'competitive' | 'co_mention';
  strengthScore: number;
  metadata?: JsonObject;
};

function trim(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clampScore(value: number, max = 100) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildMemoryKey(input: Pick<BrandMemoryInput, 'memoryType' | 'sourceType' | 'sourceKey' | 'body'>) {
  const bodyHash = createHash('sha256').update(trim(input.body).toLowerCase()).digest('hex').slice(0, 12);
  return `${input.memoryType}:${input.sourceType}:${slugify(input.sourceKey)}:${bodyHash}`;
}

export function toBrandMemoryRow(input: BrandMemoryInput) {
  return {
    memory_key: buildMemoryKey(input),
    memory_type: input.memoryType,
    source_type: input.sourceType,
    source_key: input.sourceKey,
    title: trim(input.title ?? null) || null,
    body: trim(input.body),
    tags: input.tags ?? [],
    priority: clampScore(input.priority ?? 50),
    confidence_score: clampScore(input.confidenceScore ?? 60),
    freshness_score: clampScore(input.freshnessScore ?? 70),
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  };
}

export function buildNarrativeRows(input: {
  primaryThesis: string;
  supporting: string[];
  antiThesis: string;
  approvedFrames: string[];
  proofRequirements: string[];
  disallowedPhrasing: string[];
  targetPersonas: string[];
}) {
  const centers = [
    {
      narrative_key: 'recoverystack-primary-thesis',
      title: 'RecoveryStack Primary Thesis',
      narrative_type: 'primary_thesis',
      thesis: input.primaryThesis,
      status: 'active',
      proof_requirements: input.proofRequirements,
      approved_frames: input.approvedFrames,
      disallowed_phrasing: input.disallowedPhrasing,
      target_personas: input.targetPersonas,
      metadata: {},
    },
    {
      narrative_key: 'recoverystack-supporting-theses',
      title: 'RecoveryStack Supporting Theses',
      narrative_type: 'supporting_thesis',
      thesis: input.supporting.join(' | '),
      status: 'active',
      proof_requirements: input.proofRequirements,
      approved_frames: input.approvedFrames,
      disallowed_phrasing: input.disallowedPhrasing,
      target_personas: input.targetPersonas,
      metadata: { thesis_count: input.supporting.length },
    },
    {
      narrative_key: 'recoverystack-anti-thesis',
      title: 'RecoveryStack Anti-Thesis',
      narrative_type: 'anti_thesis',
      thesis: input.antiThesis,
      status: 'active',
      proof_requirements: input.proofRequirements,
      approved_frames: input.approvedFrames,
      disallowed_phrasing: input.disallowedPhrasing,
      target_personas: input.targetPersonas,
      metadata: {},
    },
  ];

  const frames = [
    ...input.approvedFrames.map((message, index) => ({
      narrative_key: 'recoverystack-primary-thesis',
      frame_key: `approved-frame-${index + 1}`,
      channel: null,
      frame_type: 'positioning',
      message,
      status: 'active',
      metadata: {},
    })),
    ...input.proofRequirements.map((message, index) => ({
      narrative_key: 'recoverystack-primary-thesis',
      frame_key: `proof-frame-${index + 1}`,
      channel: null,
      frame_type: 'proof',
      message,
      status: 'active',
      metadata: {},
    })),
    {
      narrative_key: 'recoverystack-anti-thesis',
      frame_key: 'counter-argument-1',
      channel: null,
      frame_type: 'counter_argument',
      message: input.antiThesis,
      status: 'active',
      metadata: {},
    },
  ];

  return { centers, frames };
}

export function toShareOfVoiceRow(input: ShareOfVoiceInput) {
  return {
    snapshot_date: new Date().toISOString().slice(0, 10),
    market_slug: input.marketSlug,
    topic_slug: input.topicSlug,
    channel: input.channel,
    visibility_score: clampScore(input.visibility),
    engagement_score: clampScore(input.engagement),
    conversion_score: clampScore(input.conversion),
    authority_score: clampScore(input.authority),
    competitor_pressure_score: clampScore(input.competitorPressure),
    metadata: input.metadata ?? {},
  };
}

export function computeInfluenceScore(input: { relevance: number; relationship: number; amplification: number }) {
  return clampScore(input.relevance * 0.45 + input.relationship * 0.25 + input.amplification * 0.3);
}

export function toInfluenceNodeRow(input: InfluenceNodeInput) {
  return {
    node_key: input.nodeKey,
    node_type: input.nodeType,
    label: input.label,
    domain: input.domain ?? null,
    platform: input.platform ?? null,
    audience_segment: input.audienceSegment ?? null,
    influence_score: clampScore(input.influenceScore),
    relationship_score: clampScore(input.relationshipScore),
    amplification_score: clampScore(input.amplificationScore),
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  };
}

export function toInfluenceEdgeRow(input: InfluenceEdgeInput) {
  return {
    source_node_key: input.sourceNodeKey,
    target_node_key: input.targetNodeKey,
    edge_type: input.edgeType,
    strength_score: clampScore(input.strengthScore),
    metadata: input.metadata ?? {},
  };
}

export function buildCampaignKey(pageSlug: string, family: string) {
  return `${slugify(pageSlug)}:${slugify(family)}`;
}

export function computeCampaignMetrics(rows: Array<{ reach: number; conversions: number; priority: number }>) {
  return {
    expectedReach: clampScore(rows.reduce((sum, row) => sum + row.priority, 0), 99999),
    expectedConversions: clampScore(rows.reduce((sum, row) => sum + Math.round(row.priority / 20), 0), 99999),
    actualReach: clampScore(rows.reduce((sum, row) => sum + row.reach, 0), 99999),
    actualConversions: clampScore(rows.reduce((sum, row) => sum + row.conversions, 0), 99999),
  };
}

export function computeExecutiveAttributionScores(input: {
  firstTouchRevenue: number;
  assistedRevenue: number;
  newsletterAssists: number;
  productAssists: number;
  contentInfluenceSignals: number[];
  creatorInfluenceSignals: number[];
}) {
  return {
    first_touch_revenue_usd: Number(input.firstTouchRevenue.toFixed(2)),
    assisted_revenue_usd: Number(input.assistedRevenue.toFixed(2)),
    newsletter_assists: Math.round(input.newsletterAssists),
    product_assists: Math.round(input.productAssists),
    content_influence_score: clampScore(avg(input.contentInfluenceSignals)),
    creator_influence_score: clampScore(avg(input.creatorInfluenceSignals)),
  };
}

export function computeMoatScore(input: {
  datasetCount: number;
  frameworkCount: number;
  scoringModelCount: number;
  creatorRelationshipCount: number;
  packetCount: number;
  decisionAssetCount: number;
}) {
  const score =
    input.datasetCount * 6 +
    input.frameworkCount * 8 +
    input.scoringModelCount * 10 +
    input.creatorRelationshipCount * 3 +
    input.packetCount * 2 +
    input.decisionAssetCount * 2;
  return clampScore(score);
}

export function computeRiskScore(rows: Array<{ severity: 'low' | 'medium' | 'high' | 'critical' }>) {
  const total = rows.reduce((sum, row) => {
    if (row.severity === 'critical') return sum + 30;
    if (row.severity === 'high') return sum + 18;
    if (row.severity === 'medium') return sum + 10;
    return sum + 4;
  }, 0);
  return clampScore(total);
}

export function buildExecutiveCockpit(input: {
  brandScore: number;
  narrativeAlignmentScore: number;
  shareOfVoiceScore: number;
  influenceScore: number;
  attributionScore: number;
  moatScore: number;
  riskScore: number;
  metadata?: JsonObject;
}) {
  return {
    snapshot_date: new Date().toISOString().slice(0, 10),
    brand_score: clampScore(input.brandScore),
    narrative_alignment_score: clampScore(input.narrativeAlignmentScore),
    share_of_voice_score: clampScore(input.shareOfVoiceScore),
    influence_score: clampScore(input.influenceScore),
    attribution_score: clampScore(input.attributionScore),
    moat_score: clampScore(input.moatScore),
    risk_score: clampScore(input.riskScore),
    metadata: input.metadata ?? {},
  };
}
