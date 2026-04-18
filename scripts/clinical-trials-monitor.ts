/**
 * Clinical Trials Monitor
 *
 * Polls ClinicalTrials.gov REST API v2 for recently registered / updated
 * trials relevant to wearables, recovery, HRV, sleep, and sports medicine.
 * Results are stored in `clinical_trials` and surface in briefs as
 * `upcoming_research` context — giving content a "this is being studied now"
 * authority signal that competitors rarely have.
 *
 * Features:
 *   - 12 thematic search queries across the recovery domain
 *   - Phase filtering: Phase 2, 3, 4 + N/A (observational)
 *   - Deduplication by NCT ID
 *   - Maps trials to topic_entities by keyword overlap
 *   - Updates briefs.upcoming_research for matching page slugs
 *   - Significance scoring based on phase, enrolment size, sponsor type
 *
 * Usage:
 *   npx tsx scripts/clinical-trials-monitor.ts
 *   TRIALS_LIMIT=200 npx tsx scripts/clinical-trials-monitor.ts
 *   npx tsx scripts/clinical-trials-monitor.ts --dry-run
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limiter';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LIMIT = Number(process.env.TRIALS_LIMIT ?? 100);
const REFRESH_AFTER_DAYS = Number(process.env.TRIALS_REFRESH_DAYS ?? 3);
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

// ── Search queries covering the recovery/wearables domain ────────────────────
const SEARCH_QUERIES = [
  { query: 'heart rate variability recovery', beat: 'recovery_science' },
  { query: 'sleep quality wearable device athletes', beat: 'sleep_tech' },
  { query: 'HRV training load sports performance', beat: 'training_optimization' },
  { query: 'continuous glucose monitoring exercise', beat: 'nutrition_biometrics' },
  { query: 'cold water immersion recovery', beat: 'recovery_modalities' },
  { query: 'red light therapy muscle recovery', beat: 'recovery_modalities' },
  { query: 'compression garment exercise performance', beat: 'recovery_modalities' },
  { query: 'sleep deprivation athletic performance', beat: 'sleep_science' },
  { query: 'VO2 max wearable accuracy validation', beat: 'fitness_tech' },
  { query: 'respiratory rate monitoring wearable', beat: 'health_monitoring' },
  { query: 'blood oxygen saturation SpO2 wearable', beat: 'health_monitoring' },
  { query: 'sauna heat therapy cardiovascular recovery', beat: 'recovery_modalities' },
] as const;

type SearchQuery = (typeof SEARCH_QUERIES)[number];

// ── ClinicalTrials.gov API v2 response types ─────────────────────────────────
type CtStudy = {
  protocolSection: {
    identificationModule: {
      nctId: string;
      briefTitle: string;
      officialTitle?: string;
    };
    statusModule: {
      overallStatus: string;
      startDateStruct?: { date: string };
      completionDateStruct?: { date: string };
      studyFirstSubmitDate?: string;
      lastUpdateSubmitDate?: string;
    };
    sponsorCollaboratorsModule: {
      leadSponsor: { name: string; class: string };
    };
    descriptionModule?: {
      briefSummary?: string;
    };
    conditionsModule?: {
      conditions?: string[];
      keywords?: string[];
    };
    designModule?: {
      studyType: string;
      phases?: string[];
      enrollmentInfo?: { count?: number };
    };
    eligibilityModule?: {
      minimumAge?: string;
      maximumAge?: string;
      sex?: string;
    };
    contactsLocationsModule?: {
      overallOfficials?: Array<{ name: string; role: string; affiliation: string }>;
    };
    outcomesModule?: {
      primaryOutcomes?: Array<{ measure: string; description?: string }>;
    };
  };
};

type TrialRow = {
  nct_id: string;
  title: string;
  official_title: string | null;
  status: string;
  phase: string | null;
  study_type: string;
  sponsor_name: string;
  sponsor_class: string;
  brief_summary: string | null;
  conditions: string[];
  keywords: string[];
  primary_outcomes: string[];
  start_date: string | null;
  completion_date: string | null;
  enrollment_count: number | null;
  sex_eligibility: string | null;
  minimum_age: string | null;
  maximum_age: string | null;
  lead_official: string | null;
  lead_institution: string | null;
  significance_score: number;
  beat: string;
  matched_query: string;
  entity_ids: string[];
  page_slugs: string[];
  fetched_at: string;
};

// ── Significance scoring ──────────────────────────────────────────────────────
function scoreSignificance(study: CtStudy): number {
  let score = 40; // baseline

  const design = study.protocolSection.designModule;
  const phases = design?.phases ?? [];
  if (phases.includes('PHASE4')) score += 25;
  else if (phases.includes('PHASE3')) score += 20;
  else if (phases.includes('PHASE2')) score += 10;

  const sponsorClass = study.protocolSection.sponsorCollaboratorsModule.leadSponsor.class;
  if (sponsorClass === 'NIH') score += 20;
  else if (sponsorClass === 'FED') score += 15;
  else if (sponsorClass === 'INDIV') score -= 5;

  const enrollment = design?.enrollmentInfo?.count ?? 0;
  if (enrollment >= 500) score += 15;
  else if (enrollment >= 100) score += 10;
  else if (enrollment >= 30) score += 5;

  const status = study.protocolSection.statusModule.overallStatus;
  if (status === 'RECRUITING') score += 10;
  else if (status === 'ACTIVE_NOT_RECRUITING') score += 5;
  else if (status === 'COMPLETED') score += 8;

  return Math.min(100, Math.max(1, score));
}

// ── Fetch from ClinicalTrials.gov API v2 ─────────────────────────────────────
async function fetchTrials(searchQuery: SearchQuery): Promise<CtStudy[]> {
  await rateLimit('clinicaltrials');

  const url = new URL('https://clinicaltrials.gov/api/v2/studies');
  url.searchParams.set('query.term', searchQuery.query);
  url.searchParams.set('filter.overallStatus', 'RECRUITING,ACTIVE_NOT_RECRUITING,COMPLETED,ENROLLING_BY_INVITATION');
  url.searchParams.set('pageSize', '25');
  url.searchParams.set('sort', 'LastUpdatePostDate:desc');
  url.searchParams.set('fields', [
    'NCTId', 'BriefTitle', 'OfficialTitle', 'OverallStatus',
    'StartDate', 'CompletionDate', 'StudyFirstSubmitDate', 'LastUpdateSubmitDate',
    'LeadSponsorName', 'LeadSponsorClass',
    'BriefSummary', 'Condition', 'Keyword',
    'StudyType', 'Phase', 'EnrollmentCount',
    'MinimumAge', 'MaximumAge', 'Sex',
    'OverallOfficialName', 'OverallOfficialAffiliation',
    'PrimaryOutcomeMeasure',
  ].join(','));

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[clinical-trials] API ${res.status} for "${searchQuery.query}"`);
      return [];
    }
    const data = await res.json();
    return (data?.studies ?? []) as CtStudy[];
  } catch (err) {
    console.warn(`[clinical-trials] Fetch error for "${searchQuery.query}":`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ── Map a trial to entity IDs and page slugs by keyword overlap ───────────────
async function resolveEntityLinks(trial: CtStudy): Promise<{ entity_ids: string[]; page_slugs: string[] }> {
  const terms = [
    ...(trial.protocolSection.conditionsModule?.conditions ?? []),
    ...(trial.protocolSection.conditionsModule?.keywords ?? []),
    trial.protocolSection.identificationModule.briefTitle,
  ].map((t) => t.toLowerCase());

  const [entityResult, pageResult] = await Promise.all([
    supabase.from('topic_entities').select('id, slug, label').eq('active', true),
    supabase.from('pages').select('slug, primary_keyword, secondary_keywords').eq('status', 'published'),
  ]);

  const entity_ids: string[] = [];
  for (const entity of (entityResult.data ?? []) as Array<{ id: string; slug: string; label: string }>) {
    const entityTerms = entity.label.toLowerCase().split(/\s+/);
    if (entityTerms.some((et) => terms.some((t) => t.includes(et)))) {
      entity_ids.push(entity.id);
    }
  }

  const page_slugs: string[] = [];
  for (const page of (pageResult.data ?? []) as Array<{ slug: string; primary_keyword: string; secondary_keywords?: string[] }>) {
    const pageKeywords = [page.primary_keyword, ...(page.secondary_keywords ?? [])].map((k) => k.toLowerCase());
    const overlap = pageKeywords.filter((pk) => terms.some((t) => t.includes(pk) || pk.includes(t))).length;
    if (overlap > 0) page_slugs.push(page.slug);
  }

  return { entity_ids: entity_ids.slice(0, 10), page_slugs: page_slugs.slice(0, 20) };
}

// ── Parse a raw study into a TrialRow ────────────────────────────────────────
function parseStudy(study: CtStudy, searchQuery: SearchQuery): TrialRow {
  const id = study.protocolSection.identificationModule;
  const status = study.protocolSection.statusModule;
  const sponsor = study.protocolSection.sponsorCollaboratorsModule;
  const design = study.protocolSection.designModule;
  const desc = study.protocolSection.descriptionModule;
  const conditions = study.protocolSection.conditionsModule;
  const eligibility = study.protocolSection.eligibilityModule;
  const contacts = study.protocolSection.contactsLocationsModule;
  const outcomes = study.protocolSection.outcomesModule;

  const official = contacts?.overallOfficials?.[0];

  return {
    nct_id: id.nctId,
    title: id.briefTitle,
    official_title: id.officialTitle ?? null,
    status: status.overallStatus,
    phase: design?.phases?.join(', ') ?? null,
    study_type: design?.studyType ?? 'UNKNOWN',
    sponsor_name: sponsor.leadSponsor.name,
    sponsor_class: sponsor.leadSponsor.class,
    brief_summary: desc?.briefSummary?.trim().slice(0, 1000) ?? null,
    conditions: conditions?.conditions ?? [],
    keywords: conditions?.keywords ?? [],
    primary_outcomes: (outcomes?.primaryOutcomes ?? []).map((o) => o.measure).slice(0, 5),
    start_date: status.startDateStruct?.date ?? null,
    completion_date: status.completionDateStruct?.date ?? null,
    enrollment_count: design?.enrollmentInfo?.count ?? null,
    sex_eligibility: eligibility?.sex ?? null,
    minimum_age: eligibility?.minimumAge ?? null,
    maximum_age: eligibility?.maximumAge ?? null,
    lead_official: official?.name ?? null,
    lead_institution: official?.affiliation ?? null,
    significance_score: scoreSignificance(study),
    beat: searchQuery.beat,
    matched_query: searchQuery.query,
    entity_ids: [],
    page_slugs: [],
    fetched_at: new Date().toISOString(),
  };
}

// ── Update briefs with upcoming_research context ──────────────────────────────
async function enrichBriefs(trials: TrialRow[]): Promise<void> {
  // Group trials by page_slug
  const bySlug = new Map<string, TrialRow[]>();
  for (const trial of trials) {
    for (const slug of trial.page_slugs) {
      const arr = bySlug.get(slug) ?? [];
      arr.push(trial);
      bySlug.set(slug, arr);
    }
  }

  for (const [slug, relatedTrials] of bySlug) {
    const upcomingResearch = relatedTrials
      .sort((a, b) => b.significance_score - a.significance_score)
      .slice(0, 5)
      .map((t) => ({
        nct_id: t.nct_id,
        title: t.title,
        status: t.status,
        phase: t.phase,
        sponsor: t.sponsor_name,
        enrollment: t.enrollment_count,
        completion_date: t.completion_date,
        significance_score: t.significance_score,
        primary_outcomes: t.primary_outcomes.slice(0, 2),
      }));

    if (DRY_RUN) continue;

    await supabase
      .from('briefs')
      .update({ upcoming_research: upcomingResearch })
      .eq('page_slug', slug);
  }
}

async function run(): Promise<void> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();

  // Load recently fetched NCT IDs to skip
  const { data: recentData } = await supabase
    .from('clinical_trials')
    .select('nct_id')
    .gte('fetched_at', cutoff);
  const recentIds = new Set((recentData ?? []).map((r: any) => String(r.nct_id)));

  const allTrials: TrialRow[] = [];
  const seenNctIds = new Set<string>();

  for (const searchQuery of SEARCH_QUERIES) {
    const studies = await fetchTrials(searchQuery);

    for (const study of studies) {
      const nctId = study.protocolSection.identificationModule.nctId;
      if (seenNctIds.has(nctId) || recentIds.has(nctId)) continue;
      seenNctIds.add(nctId);

      const trial = parseStudy(study, searchQuery);
      const links = await resolveEntityLinks(study);
      trial.entity_ids = links.entity_ids;
      trial.page_slugs = links.page_slugs;

      allTrials.push(trial);
      if (allTrials.length >= LIMIT) break;
    }

    if (allTrials.length >= LIMIT) break;
  }

  console.log(`[clinical-trials] ${allTrials.length} new trials to process (dryRun=${DRY_RUN})`);

  if (DRY_RUN) {
    for (const t of allTrials.slice(0, 5)) {
      console.log(`  [dry] ${t.nct_id}: "${t.title.slice(0, 70)}" phase=${t.phase} score=${t.significance_score} pages=${t.page_slugs.length}`);
    }
    return;
  }

  let saved = 0;
  for (const trial of allTrials) {
    const { error } = await supabase
      .from('clinical_trials')
      .upsert(trial, { onConflict: 'nct_id' });

    if (error) {
      console.warn(`[clinical-trials] DB write failed for ${trial.nct_id}: ${error.message}`);
      continue;
    }
    saved++;
    console.log(
      `[clinical-trials] ${trial.nct_id}: "${trial.title.slice(0, 60)}" ` +
      `phase=${trial.phase ?? 'N/A'} score=${trial.significance_score} pages=${trial.page_slugs.length}`,
    );
  }

  await enrichBriefs(allTrials);

  console.log(`[clinical-trials] Done. Saved ${saved}/${allTrials.length} trials.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
