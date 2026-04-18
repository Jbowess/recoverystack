/**
 * Link Prospect Miner
 *
 * Identifies outreach targets — websites and journalists who link to our
 * competitors for target keywords but have NOT linked to us. These are
 * warm prospects because they've already demonstrated willingness to link
 * to this topic.
 *
 * Sources:
 *   - Ahrefs API: competitor backlink profiles per keyword
 *   - Content classification: filters to editorial links (not directories/spam)
 *
 * Outputs:
 *   - `link_prospects` table with domain authority, contact signals, context
 *   - Priority score based on: DA, relevance, link velocity, competitor count
 *
 * Usage:
 *   npx tsx scripts/link-prospect-miner.ts
 *   npx tsx scripts/link-prospect-miner.ts --dry-run
 *   PROSPECT_LIMIT=100 npx tsx scripts/link-prospect-miner.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const AHREFS_TOKEN = process.env.AHREFS_API_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.PROSPECT_LIMIT ?? 200);
const REFRESH_AFTER_DAYS = Number(process.env.PROSPECT_REFRESH_DAYS ?? 14);
const SITE_DOMAIN = (process.env.SITE_URL ?? 'https://recoverystack.io').replace(/^https?:\/\//, '').replace(/\/$/, '');

// ── Competitor domains to mine backlinks from ─────────────────────────────────
const COMPETITOR_DOMAINS = [
  'whoop.com',
  'ouraring.com',
  'health.garmin.com',
  'polar.com',
  'eightsleep.com',
  'therabody.com',
  'hyperice.com',
  'healthline.com',
  'verywellfit.com',
  'outsideonline.com',
  'menshealth.com',
  'runnersworld.com',
];

// ── Spam/low-value domain patterns to exclude ─────────────────────────────────
const EXCLUDE_PATTERNS = [
  /directory/i, /forum\./i, /\bwiki\b/i, /reddit\.com/i, /quora\.com/i,
  /pinterest\.com/i, /facebook\.com/i, /twitter\.com/i, /instagram\.com/i,
  /amazon\./i, /ebay\./i, /blogspot\.com/i, /wordpress\.com/i,
  /\.ru\//i, /\.cn\//i, /\.xyz\//i, /\.info\//i,
];

type BacklinkItem = {
  url_from: string;
  domain_rating: number | null;
  anchor: string | null;
  url_to: string;
  link_type: string;
  first_seen: string | null;
};

type ProspectRow = {
  prospect_key: string;
  referring_domain: string;
  referring_url: string;
  domain_rating: number | null;
  anchor_text: string | null;
  links_to_competitor: string;
  competitor_url_linked: string;
  link_context: string | null;
  priority_score: number;
  competitor_count: number;
  status: 'new' | 'contacted' | 'declined' | 'linked';
  discovered_at: string;
};

function buildProspectKey(domain: string, competitorDomain: string): string {
  return createHash('sha256').update(`prospect:${domain}:${competitorDomain}`).digest('hex').slice(0, 16);
}

function isSpam(url: string): boolean {
  return EXCLUDE_PATTERNS.some((p) => p.test(url));
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function classifyLinkContext(anchor: string | null, url: string): string {
  if (!anchor) return 'unknown';
  const lower = anchor.toLowerCase();
  if (/review|test|comparison|vs|alternative|compared/.test(lower)) return 'review';
  if (/guide|how to|tips|best|top|recommended/.test(lower)) return 'editorial';
  if (/study|research|science|data/.test(lower)) return 'research';
  if (/buy|price|deal|discount|shop/.test(lower)) return 'commercial';
  return 'general';
}

// ── Fetch backlinks via Ahrefs API v3 ─────────────────────────────────────────
async function fetchAhrefsBacklinks(targetDomain: string): Promise<BacklinkItem[]> {
  if (!AHREFS_TOKEN) return [];
  await rateLimit('ahrefs');

  try {
    const url = new URL('https://api.ahrefs.com/v3/site-explorer/backlinks');
    url.searchParams.set('target', targetDomain);
    url.searchParams.set('mode', 'domain');
    url.searchParams.set('limit', '200');
    url.searchParams.set('order_by', 'domain_rating:desc');
    url.searchParams.set('where', JSON.stringify({
      and: [
        { field: 'domain_rating', is: ['gte', 30] },
        { field: 'link_type', is: ['eq', 'dofollow'] },
      ],
    }));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AHREFS_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[link-prospects] Ahrefs ${res.status} for ${targetDomain}`);
      return [];
    }
    const data = await res.json();
    return (data?.backlinks ?? []) as BacklinkItem[];
  } catch (err) {
    console.warn(`[link-prospects] Ahrefs error:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Check if domain already links to us ───────────────────────────────────────
async function domainAlreadyLinksToUs(domain: string): Promise<boolean> {
  const { data } = await supabase
    .from('backlinks')
    .select('id')
    .ilike('referring_domain', `%${domain}%`)
    .limit(1);
  return (data ?? []).length > 0;
}

async function run(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  const { data: recentData } = await supabase
    .from('link_prospects')
    .select('referring_domain')
    .gte('discovered_at', cutoff);
  const recentDomains = new Set((recentData ?? []).map((r: any) => String(r.referring_domain)));

  console.log(`[link-prospects] Mining backlinks from ${COMPETITOR_DOMAINS.length} competitors (dryRun=${DRY_RUN})`);

  // Aggregate prospects: domain → {competitors linking to, best DR, anchors}
  const prospectMap = new Map<string, {
    domain: string;
    backlinks: BacklinkItem[];
    competitors: Set<string>;
  }>();

  for (const competitor of COMPETITOR_DOMAINS) {
    const backlinks = await fetchAhrefsBacklinks(competitor);
    console.log(`[link-prospects] ${competitor}: ${backlinks.length} backlinks`);

    for (const bl of backlinks) {
      const refDomain = extractDomain(bl.url_from);
      if (!refDomain || refDomain === SITE_DOMAIN) continue;
      if (isSpam(bl.url_from)) continue;
      if (recentDomains.has(refDomain)) continue;

      const existing = prospectMap.get(refDomain) ?? { domain: refDomain, backlinks: [], competitors: new Set() };
      existing.backlinks.push(bl);
      existing.competitors.add(competitor);
      prospectMap.set(refDomain, existing);
    }
  }

  // Score and filter prospects
  const prospects: ProspectRow[] = [];

  for (const [domain, data] of prospectMap) {
    if (await domainAlreadyLinksToUs(domain)) continue;

    const bestBacklink = data.backlinks.sort((a, b) => (b.domain_rating ?? 0) - (a.domain_rating ?? 0))[0];
    const dr = bestBacklink.domain_rating ?? 0;
    const competitorCount = data.competitors.size;

    // Priority score: DR (0-60) + competitor breadth (0-30) + recency (0-10)
    const drScore = Math.min(60, dr * 0.8);
    const competitorScore = Math.min(30, competitorCount * 10);
    const priorityScore = Math.round(drScore + competitorScore);

    if (priorityScore < 20) continue;

    prospects.push({
      prospect_key: buildProspectKey(domain, [...data.competitors][0]),
      referring_domain: domain,
      referring_url: bestBacklink.url_from,
      domain_rating: dr,
      anchor_text: bestBacklink.anchor,
      links_to_competitor: [...data.competitors].join(', '),
      competitor_url_linked: bestBacklink.url_to,
      link_context: classifyLinkContext(bestBacklink.anchor, bestBacklink.url_from),
      priority_score: priorityScore,
      competitor_count: competitorCount,
      status: 'new',
      discovered_at: new Date().toISOString(),
    });

    if (prospects.length >= LIMIT) break;
  }

  prospects.sort((a, b) => b.priority_score - a.priority_score);

  console.log(`[link-prospects] ${prospects.length} qualified prospects found`);

  for (const p of prospects.slice(0, 10)) {
    console.log(`  ${p.referring_domain}: DR=${p.domain_rating} competitors=${p.competitor_count} priority=${p.priority_score}`);
  }

  if (!DRY_RUN) {
    for (let i = 0; i < prospects.length; i += 50) {
      const chunk = prospects.slice(i, i + 50);
      const { error } = await supabase.from('link_prospects').upsert(chunk, { onConflict: 'prospect_key' });
      if (error) console.warn(`[link-prospects] DB write error:`, error.message);
    }
  }

  if (!AHREFS_TOKEN) {
    console.log('[link-prospects] AHREFS_API_TOKEN not set — no data fetched. Set token to enable.');
  }

  console.log(`[link-prospects] Done. Saved ${DRY_RUN ? 0 : prospects.length} prospects.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
