import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PageRow = {
  id: string;
  slug: string;
  title: string;
  template: string;
  body_json: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  source_event_id: string | null;
  storyline_id: string | null;
  published_at: string | null;
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function claimHash(value: string) {
  return createHash('sha256').update(normalizeText(value)).digest('hex');
}

function extractClaimsFromBody(page: PageRow): string[] {
  const body = page.body_json ?? {};
  const newsroom = typeof body.newsroom_context === 'object' && body.newsroom_context ? body.newsroom_context as Record<string, unknown> : {};
  const claims = [
    ...(Array.isArray(newsroom.key_claims) ? newsroom.key_claims : []),
    ...(Array.isArray(newsroom.known_facts) ? newsroom.known_facts : []),
  ]
    .map((item) => String(item).trim())
    .filter((item) => item.length >= 20);

  return Array.from(new Set(claims)).slice(0, 12);
}

function overlapScore(claim: string, evidence: string) {
  const claimTokens = new Set(normalizeText(claim).split(' ').filter((token) => token.length >= 4));
  const evidenceTokens = new Set(normalizeText(evidence).split(' ').filter((token) => token.length >= 4));
  if (!claimTokens.size || !evidenceTokens.size) return 0;
  let hits = 0;
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) hits += 1;
  }
  return hits / Math.max(claimTokens.size, 1);
}

async function processPage(page: PageRow) {
  const claims = extractClaimsFromBody(page);
  if (!claims.length) return { claims: 0, verified: 0 };

  const [referencesResult, eventsResult] = await Promise.all([
    supabase
      .from('page_source_references')
      .select('id,title,url,source_domain,evidence_level')
      .eq('page_id', page.id)
      .limit(20),
    page.storyline_id
      ? supabase
          .from('storyline_events')
          .select(`
            news_source_events (
              id,title,summary,url,source_domain,extraction
            )
          `)
          .eq('storyline_id', page.storyline_id)
          .limit(10)
      : page.source_event_id
        ? supabase
            .from('news_source_events')
            .select('id,title,summary,url,source_domain,extraction')
            .eq('id', page.source_event_id)
            .limit(1)
        : Promise.resolve({ data: [], error: null } as any),
  ]);

  const references = referencesResult.data ?? [];
  const eventRows = Array.isArray(eventsResult.data)
    ? eventsResult.data.map((row: any) => row.news_source_events ?? row).filter(Boolean)
    : [];

  let verified = 0;

  for (const claim of claims) {
    const hash = claimHash(claim);
    const evidences = [
      ...references.map((ref) => ({
        kind: 'source_reference',
        id: ref.id,
        url: ref.url,
        text: `${ref.title} ${ref.source_domain ?? ''}`,
      })),
      ...eventRows.map((event: any) => ({
        kind: 'source_event',
        id: event.id,
        url: event.url,
        text: `${event.title ?? ''} ${event.summary ?? ''} ${typeof event.extraction?.extracted_text === 'string' ? event.extraction.extracted_text.slice(0, 800) : ''}`,
      })),
    ]
      .map((evidence) => ({ ...evidence, score: overlapScore(claim, evidence.text) }))
      .filter((evidence) => evidence.score > 0.18)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const bestScore = evidences[0]?.score ?? 0;
    const status = bestScore >= 0.45 ? 'verified' : bestScore >= 0.24 ? 'partial' : 'unverified';
    if (status === 'verified') verified += 1;

    const { data: claimRow, error } = await supabase
      .from('page_claims')
      .upsert(
        {
          page_id: page.id,
          page_slug: page.slug,
          claim_hash: hash,
          claim_text: claim,
          claim_type: page.template === 'news' ? 'news_claim' : 'content_claim',
          status,
          confidence_score: Math.round(bestScore * 100),
          source_event_id: page.source_event_id,
          metadata: {
            evidence_count: evidences.length,
          },
        },
        { onConflict: 'page_id,claim_hash' },
      )
      .select('id')
      .single();

    if (error || !claimRow) continue;

    await supabase.from('claim_evidence_links').delete().eq('page_claim_id', claimRow.id);

    for (const evidence of evidences) {
      await supabase.from('claim_evidence_links').insert({
        page_claim_id: claimRow.id,
        ...(evidence.kind === 'source_event' ? { event_id: evidence.id } : { source_reference_id: evidence.id }),
        evidence_url: evidence.url,
        evidence_kind: evidence.kind,
        support_level: evidence.score >= 0.45 ? 'supported' : 'partial',
        notes: `Automated overlap score ${evidence.score.toFixed(2)}`,
        metadata: { overlap_score: evidence.score },
      });
    }
  }

  await supabase
    .from('pages')
    .update({
      metadata: {
        ...(page.metadata ?? {}),
        claim_verification_status: verified === claims.length ? 'verified' : verified > 0 ? 'mixed' : 'needs_review',
        claim_count: claims.length,
        verified_claim_count: verified,
        last_claim_reviewed_at: new Date().toISOString(),
      },
    })
    .eq('id', page.id);

  return { claims: claims.length, verified };
}

async function run() {
  const { data, error } = await supabase
    .from('pages')
    .select('id,slug,title,template,body_json,metadata,source_event_id,storyline_id,published_at')
    .in('status', ['approved', 'published'])
    .in('template', ['news', 'reviews', 'alternatives', 'guides'])
    .order('updated_at', { ascending: false })
    .limit(120);

  if (error) throw error;

  let claimCount = 0;
  let verifiedCount = 0;
  for (const page of (data ?? []) as PageRow[]) {
    const result = await processPage(page);
    claimCount += result.claims;
    verifiedCount += result.verified;
  }

  console.log(`[claim-verifier] claims=${claimCount} verified=${verifiedCount}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
