import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDistributionAssets,
  buildTrackedUrl,
  type DistributionAssetDraft,
  type DistributionPageInput,
} from '@/lib/distribution-engine';
import { similarity } from '@/lib/content-uniqueness';
import { getFreeApiChannels, isFreeApiChannel } from '@/lib/free-distribution-policy';
import type { RepurposingSourcePack } from '@/lib/types';

export type ContentAtom = {
  atomType: string;
  atomLabel: string;
  atomText: string;
  sourceSection: string | null;
  audienceSegment: string | null;
  evidenceType: string | null;
  strengthScore: number;
  fingerprint: string;
  metadata: Record<string, unknown>;
};

export type HookCandidate = {
  channel: string;
  pattern: string;
  text: string;
  score: number;
  fingerprint: string;
  metadata: Record<string, unknown>;
};

export type PacketAsset = DistributionAssetDraft & {
  originalityScore: number;
  reachScore: number;
  promoted: boolean;
};

export type RepurposingPacket = {
  summary: Record<string, unknown>;
  atoms: ContentAtom[];
  hooks: HookCandidate[];
  assets: PacketAsset[];
  visuals: Array<Record<string, unknown>>;
};

type AssetPeer = {
  channel: string;
  assetType: string;
  hook: string;
  fingerprint: string;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function hash(value: string) {
  return createHash('sha256').update(normalize(value)).digest('hex');
}

function trim(value: string | null | undefined, fallback = '') {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function trimTo(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function dedupe<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectSectionTexts(page: DistributionPageInput) {
  return (page.body_json?.sections ?? []).flatMap((section) => {
    const content = Array.isArray(section.content)
      ? section.content.map((item) => String(item))
      : typeof section.content === 'string'
        ? [section.content]
        : section.content && typeof section.content === 'object'
          ? Object.values(section.content as Record<string, unknown>).flatMap((item) =>
              Array.isArray(item) ? item.map((row) => String(row)) : [String(item)],
            )
          : [];

    return content.map((text) => ({
      heading: trim(section.heading),
      text: trim(text),
    }));
  }).filter((row) => row.text);
}

function extractVerdictLine(page: DistributionPageInput, prefix: string) {
  const found = (page.body_json?.verdict ?? []).find((line) => line.toLowerCase().startsWith(prefix));
  return found ? trim(found.replace(new RegExp(`^${prefix}\\s*`, 'i'), '')) : null;
}

function inferAudience(page: DistributionPageInput, text: string) {
  const haystack = `${page.primary_keyword ?? ''} ${page.title} ${text}`.toLowerCase();
  if (/runner|marathon|triathlon|endurance/.test(haystack)) return 'runners';
  if (/sleep|overnight|comfort/.test(haystack)) return 'sleep_buyers';
  if (/subscription|cost|price|budget|fee/.test(haystack)) return 'subscription_averse';
  if (/accuracy|hrv|validation|sensor/.test(haystack)) return 'accuracy_first';
  if (/iphone|ios/.test(haystack)) return 'iphone_buyers';
  if (/android|pixel|galaxy/.test(haystack)) return 'android_buyers';
  return 'general_buyers';
}

function inferEvidenceType(text: string) {
  const lower = text.toLowerCase();
  if (/\$|\d/.test(lower) && /(price|cost|subscription|battery|rating|days|hours)/.test(lower)) return 'dataset';
  if (/(study|journal|pubmed|validated|research)/.test(lower)) return 'scientific';
  if (/(review|complaint|users|reddit|community|app)/.test(lower)) return 'community';
  if (/(best for|avoid if|bottom line|verdict)/.test(lower)) return 'editorial';
  return 'page';
}

export function extractContentAtoms(page: DistributionPageInput): ContentAtom[] {
  const body = (page.body_json ?? {}) as NonNullable<DistributionPageInput['body_json']> & {
    faqs?: Array<{ q?: string; a?: string }>;
    repurposing_source_pack?: RepurposingSourcePack;
  };
  const sourcePack = body.repurposing_source_pack;
  const keyTakeaways = (body.key_takeaways ?? []).map((item) => trim(item));
  const sections = collectSectionTexts(page);
  const bestFor = extractVerdictLine(page, 'best for:');
  const avoidIf = extractVerdictLine(page, 'avoid if:');
  const bottomLine = extractVerdictLine(page, 'bottom line:');
  const strongestStat = [...keyTakeaways, ...sections.map((section) => section.text)].find((row) => /\d/.test(row)) ?? trim(page.meta_description);
  const strongestClaim = keyTakeaways[0] ?? bottomLine ?? trim(page.meta_description, page.title);
  const strongestObjection = avoidIf ?? sections.find((section) => /but|however|avoid|problem|issue|friction/i.test(section.text))?.text ?? trim(page.intro, page.title);
  const bestFaq = (body.faqs ?? [])[0];
  const comparisonRows = body.comparison_table?.rows ?? [];
  const comparisonDelta = comparisonRows[0]?.join(' | ') ?? strongestClaim;

  const packAtoms: Array<Omit<ContentAtom, 'fingerprint'>> = sourcePack ? [
    {
      atomType: 'primary_thesis',
      atomLabel: 'Primary thesis',
      atomText: sourcePack.primary_thesis,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.best_for_split),
      evidenceType: 'editorial',
      strengthScore: 96,
      metadata: { source_pack: true },
    },
    {
      atomType: 'contrarian_line',
      atomLabel: 'Contrarian line',
      atomText: sourcePack.contrarian_line,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.contrarian_line),
      evidenceType: 'editorial',
      strengthScore: 92,
      metadata: { source_pack: true },
    },
    {
      atomType: 'quoted_stat',
      atomLabel: 'Quoted stat',
      atomText: sourcePack.quoted_stat,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.quoted_stat),
      evidenceType: inferEvidenceType(sourcePack.quoted_stat),
      strengthScore: /\d/.test(sourcePack.quoted_stat) ? 94 : 84,
      metadata: { source_pack: true },
    },
    {
      atomType: 'strongest_objection',
      atomLabel: 'Strongest objection',
      atomText: sourcePack.strongest_objection,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.strongest_objection),
      evidenceType: 'editorial',
      strengthScore: 90,
      metadata: { source_pack: true },
    },
    {
      atomType: 'best_for_split',
      atomLabel: 'Best-for split',
      atomText: sourcePack.best_for_split,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.best_for_split),
      evidenceType: 'editorial',
      strengthScore: 88,
      metadata: { source_pack: true },
    },
    {
      atomType: 'avoid_if_split',
      atomLabel: 'Avoid-if split',
      atomText: sourcePack.avoid_if_split,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.avoid_if_split),
      evidenceType: 'editorial',
      strengthScore: 88,
      metadata: { source_pack: true },
    },
    {
      atomType: 'emotional_tension',
      atomLabel: 'Emotional tension',
      atomText: sourcePack.emotional_tension,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.emotional_tension),
      evidenceType: 'page',
      strengthScore: 86,
      metadata: { source_pack: true },
    },
    {
      atomType: 'decision_trigger',
      atomLabel: 'Decision trigger',
      atomText: sourcePack.decision_trigger,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.decision_trigger),
      evidenceType: 'page',
      strengthScore: 86,
      metadata: { source_pack: true },
    },
    {
      atomType: 'visual_hook',
      atomLabel: 'Visual hook',
      atomText: sourcePack.visual_hook,
      sourceSection: 'repurposing_source_pack',
      audienceSegment: inferAudience(page, sourcePack.visual_hook),
      evidenceType: 'page',
      strengthScore: 82,
      metadata: { source_pack: true },
    },
  ] : [];

  const rawAtoms: Array<Omit<ContentAtom, 'fingerprint'>> = [
    ...packAtoms,
    {
      atomType: 'strongest_claim',
      atomLabel: 'Strongest claim',
      atomText: sourcePack?.primary_thesis ?? strongestClaim,
      sourceSection: 'key_takeaways',
      audienceSegment: inferAudience(page, sourcePack?.primary_thesis ?? strongestClaim),
      evidenceType: inferEvidenceType(sourcePack?.primary_thesis ?? strongestClaim),
      strengthScore: 90,
      metadata: {},
    },
    {
      atomType: 'best_for',
      atomLabel: 'Best for',
      atomText: bestFor ?? strongestClaim,
      sourceSection: 'verdict',
      audienceSegment: inferAudience(page, bestFor ?? strongestClaim),
      evidenceType: 'editorial',
      strengthScore: 84,
      metadata: {},
    },
    {
      atomType: 'avoid_if',
      atomLabel: 'Avoid if',
      atomText: sourcePack?.avoid_if_split ?? strongestObjection,
      sourceSection: 'verdict',
      audienceSegment: inferAudience(page, sourcePack?.avoid_if_split ?? strongestObjection),
      evidenceType: inferEvidenceType(sourcePack?.avoid_if_split ?? strongestObjection),
      strengthScore: 86,
      metadata: {},
    },
    {
      atomType: 'best_stat',
      atomLabel: 'Best stat',
      atomText: sourcePack?.quoted_stat ?? strongestStat,
      sourceSection: 'evidence',
      audienceSegment: inferAudience(page, sourcePack?.quoted_stat ?? strongestStat),
      evidenceType: inferEvidenceType(sourcePack?.quoted_stat ?? strongestStat),
      strengthScore: /\d/.test(sourcePack?.quoted_stat ?? strongestStat) ? 88 : 68,
      metadata: {},
    },
    {
      atomType: 'comparison_delta',
      atomLabel: 'Comparison delta',
      atomText: comparisonDelta,
      sourceSection: 'comparison_table',
      audienceSegment: inferAudience(page, comparisonDelta),
      evidenceType: inferEvidenceType(comparisonDelta),
      strengthScore: 82,
      metadata: {},
    },
    {
      atomType: 'who_this_is_for',
      atomLabel: 'Who this is for',
      atomText: bestFor ?? strongestClaim,
      sourceSection: 'verdict',
      audienceSegment: inferAudience(page, bestFor ?? strongestClaim),
      evidenceType: 'editorial',
      strengthScore: 78,
      metadata: {},
    },
    {
      atomType: 'faq_answer',
      atomLabel: bestFaq?.q ? trim(bestFaq.q) : 'FAQ answer',
      atomText: trim(bestFaq?.a, strongestClaim),
      sourceSection: 'faq',
      audienceSegment: inferAudience(page, trim(bestFaq?.a, strongestClaim)),
      evidenceType: inferEvidenceType(trim(bestFaq?.a, strongestClaim)),
      strengthScore: 70,
      metadata: {},
    },
    {
      atomType: 'cta_hook',
      atomLabel: 'CTA hook',
      atomText: sourcePack?.decision_trigger ?? trim(page.meta_description, page.title),
      sourceSection: 'meta',
      audienceSegment: inferAudience(page, sourcePack?.decision_trigger ?? trim(page.meta_description, page.title)),
      evidenceType: 'page',
      strengthScore: sourcePack?.decision_trigger ? 78 : 64,
      metadata: {},
    },
  ];

  return dedupe(
    rawAtoms
      .filter((atom) => atom.atomText)
      .map((atom) => ({
        ...atom,
        fingerprint: hash(atom.atomText),
      })),
    (atom) => `${atom.atomType}:${atom.fingerprint}`,
  );
}

const HOOK_PATTERNS = [
  'contrarian',
  'mistake_led',
  'myth_busting',
  'cost_shock',
  'comparison_shock',
  'buyer_warning',
  'hidden_signal',
  'avoid_if',
] as const;

function buildHookText(pattern: (typeof HOOK_PATTERNS)[number], page: DistributionPageInput, atom: ContentAtom, variant: number) {
  const keyword = trim(page.primary_keyword, page.title);
  switch (pattern) {
    case 'contrarian':
      return `The real ${keyword} decision is not features. It is ${atom.atomText.toLowerCase()}.`;
    case 'mistake_led':
      return `Most buyers get ${keyword} wrong because they ignore ${atom.atomText.toLowerCase()}.`;
    case 'myth_busting':
      return `Myth: ${keyword} is mainly about specs. Reality: ${atom.atomText}.`;
    case 'cost_shock':
      return `The expensive part of ${keyword} is not the sticker price. It is ${atom.atomText.toLowerCase()}.`;
    case 'comparison_shock':
      return `${keyword}: the real split is ${atom.atomText.toLowerCase()}, not the brand headline.`;
    case 'buyer_warning':
      return `Buyer warning for ${keyword}: if ${atom.atomText.toLowerCase()}, stop before you buy.`;
    case 'hidden_signal':
      return `The signal most people miss in ${keyword} coverage: ${atom.atomText}.`;
    case 'avoid_if':
      return `Avoid this ${keyword} path if ${atom.atomText.toLowerCase()}.`;
    default:
      return `${keyword}: ${atom.atomText}`;
  }
}

function scoreHook(pattern: string, atom: ContentAtom, text: string) {
  let score = 46;
  if (atom.strengthScore >= 84) score += 16;
  if (/\d/.test(text)) score += 10;
  if (/avoid|warning|mistake|myth|real/.test(text.toLowerCase())) score += 10;
  if (['contrarian', 'comparison_shock', 'buyer_warning'].includes(pattern)) score += 8;
  if (text.length >= 70 && text.length <= 140) score += 6;
  return Math.min(99, score);
}

export function buildHookLaboratory(page: DistributionPageInput, atoms: ContentAtom[]): HookCandidate[] {
  const seedAtoms = atoms.slice(0, 4);
  const hooks: HookCandidate[] = [];
  const channels = ['x', 'linkedin', 'reddit', 'newsletter', 'short_video', 'instagram'];

  for (const channel of channels) {
    for (const pattern of HOOK_PATTERNS) {
      for (let variant = 0; variant < Math.min(2, seedAtoms.length); variant += 1) {
        const atom = seedAtoms[variant] ?? seedAtoms[0];
        if (!atom) continue;
        const text = trimTo(buildHookText(pattern, page, atom, variant), channel === 'x' ? 180 : 220);
        hooks.push({
          channel,
          pattern,
          text,
          score: scoreHook(pattern, atom, text),
          fingerprint: hash(`${channel}:${text}`),
          metadata: {
            atom_type: atom.atomType,
            audience_segment: atom.audienceSegment,
            evidence_type: atom.evidenceType,
          },
        });
      }
    }
  }

  return dedupe(hooks, (hook) => hook.fingerprint).sort((a, b) => b.score - a.score);
}

function makeAsset(
  page: DistributionPageInput,
  channel: string,
  assetType: string,
  hook: HookCandidate,
  body: string,
  summary: string,
  extraPayload: Record<string, unknown> = {},
): DistributionAssetDraft {
  const tracked = buildTrackedUrl(
    `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
    channel as any,
    assetType,
    page.slug,
  );

  return {
    channel: channel as any,
    assetType,
    title: `${page.title} ${assetType.replace(/_/g, ' ')}`.trim(),
    hook: hook.text,
    summary,
    body,
    ctaLabel: 'Open the full page',
    ctaUrl: tracked,
    hashtags: [],
    payload: {
      hook_pattern: hook.pattern,
      audience_segment: hook.metadata.audience_segment ?? null,
      evidence_type: hook.metadata.evidence_type ?? null,
      hook_score: hook.score,
      ...extraPayload,
    },
  };
}

function buildAdditionalAssets(page: DistributionPageInput, hooks: HookCandidate, atoms: ContentAtom[]): DistributionAssetDraft[] {
  const strongest = atoms[0]?.atomText ?? trim(page.meta_description, page.title);
  const objection = atoms.find((atom) => atom.atomType === 'avoid_if')?.atomText ?? strongest;
  const stat = atoms.find((atom) => atom.atomType === 'best_stat')?.atomText ?? strongest;
  const bestFor = atoms.find((atom) => atom.atomType === 'best_for')?.atomText ?? strongest;

  return [
    makeAsset(page, 'newsletter', 'email_brief', hooks, `${hooks.text}\n\nWhy it matters now:\n${strongest}\n\nWarning:\n${objection}`, 'Curated issue-ready email brief.', { campaign_family: 'email_bundle' }),
    makeAsset(page, 'linkedin', 'founder_opinion', hooks, `${hooks.text}\n\nMarket thesis:\n${strongest}\n\nWhat buyers miss:\n${objection}`, 'Opinion-led LinkedIn post.', { campaign_family: 'thesis_bundle' }),
    makeAsset(page, 'reddit', 'answer_post', hooks, `Short answer:\n${strongest}\n\nNuance:\n${objection}\n\nBest fit:\n${bestFor}`, 'Reddit-native answer format.', { campaign_family: 'community_bundle' }),
    makeAsset(page, 'short_video', 'video_script', hooks, `Hook: ${hooks.text}\nBeat 1: ${strongest}\nBeat 2: ${stat}\nBeat 3: ${objection}\nCTA: read the full breakdown`, 'Short-form video script.', { campaign_family: 'video_bundle' }),
    makeAsset(page, 'instagram', 'carousel_outline', hooks, `Slide 1 ${hooks.text}\nSlide 2 ${strongest}\nSlide 3 ${stat}\nSlide 4 ${bestFor}\nSlide 5 ${objection}`, 'Carousel outline.', { campaign_family: 'visual_bundle' }),
    makeAsset(page, 'instagram', 'infographic_brief', hooks, `Graphic title: ${page.title}\nPrimary stat: ${stat}\nBuyer fit: ${bestFor}\nCaution: ${objection}`, 'Infographic brief.', { campaign_family: 'visual_bundle' }),
  ];
}

function scoreOriginality(asset: DistributionAssetDraft, peers: AssetPeer[]) {
  const hook = trim(asset.hook);
  const fp = hash(`${asset.channel}:${hook}`);
  const nearest = peers
    .map((peer) => ({
      peer,
      similarity: similarity(fp.slice(0, 16), peer.fingerprint.slice(0, 16)),
    }))
    .sort((a, b) => b.similarity - a.similarity)[0];

  let score = 85;
  if (nearest?.similarity >= 0.96) score -= 45;
  else if (nearest?.similarity >= 0.9) score -= 24;
  else if (nearest?.similarity >= 0.82) score -= 12;
  if (peers.some((peer) => peer.channel === asset.channel && peer.assetType === asset.assetType && peer.hook === hook)) score -= 20;
  return clamp(score);
}

function scoreReach(asset: DistributionAssetDraft, hooks: HookCandidate[], atoms: ContentAtom[]) {
  const payload = asset.payload ?? {};
  const hookScore = typeof payload.hook_score === 'number' ? payload.hook_score : hooks.find((hook) => hook.text === asset.hook)?.score ?? 50;
  const evidenceBonus = atoms.filter((atom) => atom.evidenceType && atom.evidenceType !== 'page').length * 4;
  const emotionalBonus = /(warning|mistake|myth|real|avoid)/i.test(asset.hook) ? 8 : 0;
  const channelFit =
    asset.channel === 'short_video' ? 14 :
    asset.channel === 'linkedin' ? 12 :
    asset.channel === 'x' ? 10 :
    asset.channel === 'newsletter' ? 12 :
    asset.channel === 'reddit' ? 10 : 8;
  const assetTypeBonus =
    ['video_script', 'carousel_outline', 'infographic_brief', 'email_brief'].includes(asset.assetType) ? 10 : 5;
  return Math.min(99, hookScore + evidenceBonus + emotionalBonus + channelFit + assetTypeBonus);
}

function clamp(value: number) {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function selectPromotedAssets(assets: PacketAsset[]) {
  const byChannel = new Map<string, PacketAsset[]>();
  for (const asset of assets) {
    const list = byChannel.get(asset.channel) ?? [];
    list.push(asset);
    byChannel.set(asset.channel, list);
  }

  return [...byChannel.values()].flatMap((rows) =>
    rows
      .sort((a, b) => (b.reachScore + b.originalityScore) - (a.reachScore + a.originalityScore))
      .slice(0, 2)
      .map((asset) => ({ ...asset, promoted: true })),
  );
}

function buildVisualBriefs(page: DistributionPageInput, atoms: ContentAtom[]) {
  const bestFor = atoms.find((atom) => ['best_for_split', 'best_for'].includes(atom.atomType))?.atomText ?? page.title;
  const stat = atoms.find((atom) => atom.atomType === 'best_stat')?.atomText ?? trim(page.meta_description, page.title);
  const objection = atoms.find((atom) => ['avoid_if_split', 'avoid_if', 'strongest_objection'].includes(atom.atomType))?.atomText ?? bestFor;
  const visualHook = atoms.find((atom) => atom.atomType === 'visual_hook')?.atomText ?? stat;

  return [
    { visual_type: 'comparison_carousel', title: `${page.title} comparison carousel`, brief: `Lead with ${visualHook}. Contrast best fit ${bestFor} against caution ${objection}.` },
    { visual_type: 'ranking_card', title: `${page.title} ranking card`, brief: `Show one decisive scorecard around ${bestFor}.` },
    { visual_type: 'quote_card', title: `${page.title} quote card`, brief: trim(page.meta_description, page.title) },
    { visual_type: 'myth_vs_reality', title: `${page.title} myth vs reality`, brief: `Myth: generic feature list. Reality: ${objection}.` },
    { visual_type: 'cost_breakdown_chart', title: `${page.title} cost breakdown`, brief: stat },
  ];
}

export function buildRepurposingPacket(page: DistributionPageInput, peers: AssetPeer[] = []): RepurposingPacket {
  const atoms = extractContentAtoms(page);
  const hooks = buildHookLaboratory(page, atoms);
  const baseAssets = buildDistributionAssets(page);
  const extraAssets = buildAdditionalAssets(page, hooks[0] ?? {
    channel: 'x',
    pattern: 'contrarian',
    text: trim(page.meta_description, page.title),
    score: 55,
    fingerprint: hash(page.title),
    metadata: {},
  }, atoms);

  const packetAssets = [...baseAssets, ...extraAssets].map((asset) => {
    const originalityScore = scoreOriginality(asset, peers);
    const reachScore = scoreReach(asset, hooks, atoms);
    return {
      ...asset,
      payload: {
        ...(asset.payload ?? {}),
        reach_score: reachScore,
        originality_score: originalityScore,
        repurposing_packet_version: 'v1_campaign_engine',
      },
      originalityScore,
      reachScore,
      promoted: false,
    };
  });

  const promoted = selectPromotedAssets(packetAssets);
  const promotedKeys = new Set(promoted.map((asset) => `${asset.channel}:${asset.assetType}:${asset.hook}`));
  const finalAssets = packetAssets.map((asset) => ({
    ...asset,
    promoted: promotedKeys.has(`${asset.channel}:${asset.assetType}:${asset.hook}`),
  }));

  return {
    summary: {
      page_slug: page.slug,
      atom_count: atoms.length,
      hook_count: hooks.length,
      asset_count: finalAssets.length,
      promoted_count: finalAssets.filter((asset) => asset.promoted).length,
      campaign_family: 'page_to_campaign',
    },
    atoms,
    hooks,
    assets: finalAssets,
    visuals: buildVisualBriefs(page, atoms),
  };
}

export async function loadRecentAssetPeers(supabase: SupabaseClient, limit = 250): Promise<AssetPeer[]> {
  const { data, error } = await supabase
    .from('distribution_assets')
    .select('channel,asset_type,hook,payload')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error?.message?.includes('distribution_assets')) return [];
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    channel: String(row.channel ?? ''),
    assetType: String(row.asset_type ?? ''),
    hook: trim(row.hook),
    fingerprint: hash(`${row.channel}:${trim(row.hook)}`),
  })).filter((row) => row.hook);
}

export async function persistRepurposingPacket(
  supabase: SupabaseClient,
  page: DistributionPageInput,
  packet: RepurposingPacket,
) {
  const packetWrite = await supabase.from('repurposing_packets').upsert({
    page_id: page.id,
    page_slug: page.slug,
    packet_version: 'v1_campaign_engine',
    packet_status: 'ready',
    summary: packet.summary,
    atoms: packet.atoms,
    hooks: packet.hooks,
    channel_bundles: packet.assets.map((asset) => ({
      channel: asset.channel,
      asset_type: asset.assetType,
      promoted: asset.promoted,
      reach_score: asset.reachScore,
      originality_score: asset.originalityScore,
    })),
    visuals: packet.visuals,
    updated_at: new Date().toISOString(),
  });
  if (packetWrite.error && !packetWrite.error.message.includes('repurposing_packets')) throw packetWrite.error;

  const deleteAtoms = await supabase.from('content_atoms').delete().eq('page_slug', page.slug);
  if (deleteAtoms.error && !deleteAtoms.error.message.includes('content_atoms')) throw deleteAtoms.error;

  if (packet.atoms.length > 0) {
    const insertAtoms = await supabase.from('content_atoms').insert(
      packet.atoms.map((atom) => ({
        page_id: page.id,
        page_slug: page.slug,
        atom_type: atom.atomType,
        atom_label: atom.atomLabel,
        atom_text: atom.atomText,
        source_section: atom.sourceSection,
        audience_segment: atom.audienceSegment,
        evidence_type: atom.evidenceType,
        strength_score: atom.strengthScore,
        fingerprint: atom.fingerprint,
        metadata: atom.metadata,
      })),
    );
    if (insertAtoms.error && !insertAtoms.error.message.includes('content_atoms')) throw insertAtoms.error;
  }

  const deleteHooks = await supabase.from('channel_hook_library').delete().eq('page_slug', page.slug);
  if (deleteHooks.error && !deleteHooks.error.message.includes('channel_hook_library')) throw deleteHooks.error;

  if (packet.hooks.length > 0) {
    const insertHooks = await supabase.from('channel_hook_library').insert(
      packet.hooks.map((hook) => ({
        page_id: page.id,
        page_slug: page.slug,
        channel: hook.channel,
        hook_pattern: hook.pattern,
        hook_text: hook.text,
        fingerprint: hook.fingerprint,
        originality_score: null,
        predicted_reach_score: hook.score,
        status: 'candidate',
        metadata: hook.metadata,
      })),
    );
    if (insertHooks.error && !insertHooks.error.message.includes('channel_hook_library')) throw insertHooks.error;
  }

  const deleteOriginality = await supabase.from('repurposing_originality_scores').delete().eq('page_slug', page.slug);
  if (deleteOriginality.error && !deleteOriginality.error.message.includes('repurposing_originality_scores')) throw deleteOriginality.error;

  const originalityRows = packet.assets.map((asset) => ({
    page_id: page.id,
    page_slug: page.slug,
    asset_channel: asset.channel,
    asset_type: asset.assetType,
    originality_score: asset.originalityScore,
    status: asset.originalityScore >= 70 ? 'pass' : asset.originalityScore >= 55 ? 'review' : 'fail',
    nearest_match: null,
    nearest_similarity: null,
    breakdown: {
      reach_score: asset.reachScore,
      promoted: asset.promoted,
      hook_pattern: asset.payload?.hook_pattern ?? null,
    },
  }));
  if (originalityRows.length > 0) {
    const insertOriginality = await supabase.from('repurposing_originality_scores').insert(originalityRows);
    if (insertOriginality.error && !insertOriginality.error.message.includes('repurposing_originality_scores')) throw insertOriginality.error;
  }
}

export async function promotePacketAssets(
  supabase: SupabaseClient,
  page: DistributionPageInput,
  packet: RepurposingPacket,
) {
  const allowedChannels = new Set(getFreeApiChannels());
  const promoted = packet.assets.filter((asset) => asset.promoted && allowedChannels.has(asset.channel));
  if (promoted.length === 0) return;

  const siteUrl = process.env.SITE_URL ?? 'https://recoverystack.io';
  const assetRows = promoted.map((asset) => ({
    page_id: page.id,
    page_slug: page.slug,
    page_template: page.template,
    channel: asset.channel,
    asset_type: asset.assetType,
    status: asset.originalityScore >= 60 ? 'approved' : 'draft',
    title: asset.title,
    hook: asset.hook,
    summary: asset.summary,
    body: asset.body,
    cta_label: asset.ctaLabel,
    cta_url: asset.ctaUrl,
    hashtags: asset.hashtags,
    payload: asset.payload,
    source_url: `${siteUrl}/${page.template}/${page.slug}`,
  }));

  const upsertAssets = await supabase.from('distribution_assets').upsert(assetRows, {
    onConflict: 'page_id,channel,asset_type',
  });
  if (upsertAssets.error && !upsertAssets.error.message.includes('distribution_assets')) throw upsertAssets.error;

  const freshAssets = await supabase
    .from('distribution_assets')
    .select('id,page_id,page_slug,channel,asset_type,title,hook,summary,body,cta_url,payload')
    .eq('page_slug', page.slug)
    .in('channel', promoted.map((asset) => asset.channel))
    .limit(50);

  if (freshAssets.error?.message?.includes('distribution_assets')) return;
  if (freshAssets.error) throw freshAssets.error;

  const queueRows = (freshAssets.data ?? []).map((asset: any) => ({
    distribution_asset_id: asset.id,
    page_id: asset.page_id,
    page_slug: asset.page_slug,
    channel: asset.channel,
    publish_status: 'pending_approval',
    publish_priority: Math.min(
      99,
      50 +
        Math.round(Number(asset.payload?.reach_score ?? 0) / 4) +
        Math.round(Number(asset.payload?.repurposing_score ?? 0) / 8),
    ),
    approval_required: !['newsletter', 'bluesky'].includes(String(asset.channel ?? '')),
    body: asset.body ?? asset.summary ?? asset.title ?? asset.page_slug,
    asset_title: asset.title,
    link_url: asset.cta_url,
    platform_payload: {
      reach_score: asset.payload?.reach_score ?? null,
      originality_score: asset.payload?.originality_score ?? null,
      hook_pattern: asset.payload?.hook_pattern ?? null,
      audience_segment: asset.payload?.audience_segment ?? null,
      campaign_family: asset.payload?.campaign_family ?? null,
    },
  }));

  if (queueRows.length > 0) {
    const upsertQueue = await supabase.from('channel_publication_queue').upsert(queueRows, {
      onConflict: 'distribution_asset_id,channel',
    });
    if (upsertQueue.error && !upsertQueue.error.message.includes('channel_publication_queue')) throw upsertQueue.error;
  }
}

export async function buildAndPersistRepurposingPacket(
  supabase: SupabaseClient,
  page: DistributionPageInput,
) {
  const peers = await loadRecentAssetPeers(supabase);
  const packet = buildRepurposingPacket(page, peers);
  await persistRepurposingPacket(supabase, page, packet);
  await promotePacketAssets(supabase, page, packet);
  return packet;
}
