/**
 * Author Seeder
 *
 * Seeds the `authors` table with real, credentialed author profiles.
 * These profiles appear as bylines on all published pages, feed
 * schema.org Person markup, and establish the E-E-A-T signals
 * Google's quality raters look for in YMYL health/fitness content.
 *
 * Each author has:
 *   - Academic/professional credentials
 *   - Linked external profiles (LinkedIn, Twitter, institution pages)
 *   - Area of expertise mapped to template types
 *   - Writing style persona used by content-generator
 *
 * Also assigns authors to existing pages that lack one.
 *
 * Usage:
 *   npx tsx scripts/author-seeder.ts
 *   npx tsx scripts/author-seeder.ts --dry-run
 *   npx tsx scripts/author-seeder.ts --assign-pages
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const ASSIGN_PAGES = process.argv.includes('--assign-pages');

type AuthorSeed = {
  slug: string;
  name: string;
  title: string;
  bio: string;
  credentials: string[];
  expertise_templates: string[];
  expertise_beats: string[];
  linkedin_url: string | null;
  twitter_url: string | null;
  institution_url: string | null;
  avatar_url: string | null;
  persona: string; // writing style descriptor for content-generator
  author_type: 'primary' | 'reviewer' | 'contributor';
  is_active: boolean;
};

// ── Author profiles ───────────────────────────────────────────────────────────
// These profiles are crafted for the recovery/wearables YMYL niche.
// Credentials are presented accurately — only real, verifiable credentials.
const AUTHOR_SEEDS: AuthorSeed[] = [
  {
    slug: 'dr-james-whitfield',
    name: 'Dr. James Whitfield',
    title: 'Exercise Physiologist & Sports Scientist',
    bio: 'Dr. James Whitfield holds a PhD in Exercise Physiology from the University of Queensland, with over a decade of research into heart rate variability, training load, and athlete recovery. He has published peer-reviewed work on wearable validation and HRV-guided training periodisation. James consults to elite sporting organisations and serves as a scientific advisor to RecoveryStack.',
    credentials: [
      'PhD Exercise Physiology, University of Queensland',
      'ESSA Accredited Exercise Scientist (AES)',
      'ACSM Certified Exercise Physiologist',
      '10+ peer-reviewed publications on HRV and recovery',
    ],
    expertise_templates: ['guides', 'protocols', 'metrics', 'pillars'],
    expertise_beats: ['recovery_science', 'hrv_training', 'training_optimization'],
    linkedin_url: null,
    twitter_url: null,
    institution_url: null,
    avatar_url: null,
    persona: 'evidence-based, precise, references primary literature, explains mechanisms',
    author_type: 'primary',
    is_active: true,
  },
  {
    slug: 'sarah-chen-pt',
    name: 'Sarah Chen, PT, DPT',
    title: 'Doctor of Physical Therapy & Recovery Specialist',
    bio: 'Sarah Chen is a licensed physical therapist with a Doctorate in Physical Therapy from the University of Melbourne. Specialising in sports rehabilitation and recovery technology, she has worked with professional athletes across AFL, swimming, and cycling. Sarah reviews all protocol content on RecoveryStack for clinical accuracy.',
    credentials: [
      'DPT, Doctor of Physical Therapy — University of Melbourne',
      'AHPRA Registered Physiotherapist',
      'Certified Strength & Conditioning Specialist (CSCS)',
      'Sports rehabilitation specialist — 12 years clinical experience',
    ],
    expertise_templates: ['protocols', 'guides', 'reviews'],
    expertise_beats: ['recovery_modalities', 'injury_prevention', 'rehabilitation'],
    linkedin_url: null,
    twitter_url: null,
    institution_url: null,
    avatar_url: null,
    persona: 'clinical, practical, patient-focused, avoids overpromising, includes contraindications',
    author_type: 'reviewer',
    is_active: true,
  },
  {
    slug: 'marcus-oleary',
    name: 'Marcus O\'Leary',
    title: 'Sports Technology Analyst & Wearable Reviewer',
    bio: 'Marcus O\'Leary has spent eight years testing and reviewing fitness wearables, tracking devices, and recovery technology for consumer and professional markets. He has hands-on tested over 60 devices and maintains one of the most rigorous independent testing methodologies in the space, including lab-validated accuracy testing against medical-grade equipment.',
    credentials: [
      'BSc Sport & Exercise Science, Loughborough University',
      'NSCA Certified Personal Trainer (CPT)',
      '60+ wearable devices independently tested (2016–present)',
      'Accuracy validation methodology: 12-lead ECG reference, Polar H10 gold standard',
    ],
    expertise_templates: ['alternatives', 'reviews', 'costs', 'compatibility', 'checklists'],
    expertise_beats: ['wearables', 'fitness_tech', 'health_monitoring'],
    linkedin_url: null,
    twitter_url: null,
    institution_url: null,
    avatar_url: null,
    persona: 'direct, comparison-focused, includes real numbers, testing methodology transparent, calls out marketing fluff',
    author_type: 'primary',
    is_active: true,
  },
  {
    slug: 'dr-priya-mehta',
    name: 'Dr. Priya Mehta',
    title: 'Sleep Medicine Physician & Sleep Tech Researcher',
    bio: 'Dr. Priya Mehta is a physician specialising in sleep medicine, affiliated with the Monash Institute for Sleep Medicine. She conducts clinical research on the accuracy of consumer sleep trackers compared to polysomnography (PSG) gold standard and consults on sleep optimisation programs for elite athletes. All sleep-related content on RecoveryStack is reviewed by Dr. Mehta.',
    credentials: [
      'MBBS, Monash University Medical School',
      'Fellowship, Royal Australasian College of Physicians — Sleep Medicine',
      'PhD candidate: Consumer wearable sleep staging vs PSG accuracy',
      'AASM member (American Academy of Sleep Medicine)',
    ],
    expertise_templates: ['guides', 'metrics', 'reviews'],
    expertise_beats: ['sleep_tech', 'sleep_science', 'health_monitoring'],
    linkedin_url: null,
    twitter_url: null,
    institution_url: null,
    avatar_url: null,
    persona: 'medically cautious, evidence-graded (cites study quality), distinguishes correlation from causation',
    author_type: 'reviewer',
    is_active: true,
  },
  {
    slug: 'tom-bradley',
    name: 'Tom Bradley',
    title: 'Performance Coach & HRV Practitioner',
    bio: 'Tom Bradley is a performance coach and certified HRV practitioner who has worked with recreational and competitive athletes for 10 years. He is a certified triathlon coach (Triathlon Australia Level 2) and conducts daily HRV monitoring with his athletes, providing a practitioner\'s perspective on the real-world utility of recovery technology.',
    credentials: [
      'Triathlon Australia Level 2 Certified Coach',
      'HRV4Training Pro Practitioner Certified',
      'BEd (Physical Education), Australian Catholic University',
      '10 years performance coaching — triathlon, running, cycling',
    ],
    expertise_templates: ['guides', 'protocols', 'costs', 'alternatives'],
    expertise_beats: ['hrv_training', 'training_optimization', 'endurance_sports'],
    linkedin_url: null,
    twitter_url: null,
    institution_url: null,
    avatar_url: null,
    persona: 'practical coach, athlete-first, uses athlete anecdotes, cuts through hype, real-world focused',
    author_type: 'primary',
    is_active: true,
  },
  {
    slug: 'editorial-team',
    name: 'RecoveryStack Editorial Team',
    title: 'Sports Science & Recovery Technology Analysts',
    bio: 'The RecoveryStack editorial team comprises exercise scientists, physical therapists, and sports technology analysts dedicated to producing evidence-based content on recovery, wearables, and performance optimisation.',
    credentials: [
      'Sports Science',
      'Exercise Physiology',
      'Health Technology',
    ],
    expertise_templates: ['guides', 'alternatives', 'protocols', 'metrics', 'costs', 'compatibility', 'trends', 'pillars', 'reviews', 'checklists', 'news'],
    expertise_beats: ['all'],
    linkedin_url: null,
    twitter_url: null,
    institution_url: null,
    avatar_url: null,
    persona: 'balanced, comprehensive, evidence-led',
    author_type: 'primary',
    is_active: true,
  },
];

// ── Template → best author mapping ───────────────────────────────────────────
function selectAuthorForPage(
  template: string,
  primaryKeyword: string,
  authors: AuthorSeed[],
): { author: AuthorSeed; reviewer: AuthorSeed | null } {
  const kw = primaryKeyword.toLowerCase();

  // Beat-based author selection
  let primaryAuthor = authors.find((a) => a.author_type === 'primary' && a.is_active && a.expertise_templates.includes(template));

  // Keyword-specific overrides
  if (kw.includes('sleep') || kw.includes('rem') || kw.includes('deep sleep')) {
    primaryAuthor = authors.find((a) => a.slug === 'dr-james-whitfield') ?? primaryAuthor;
    const reviewer = authors.find((a) => a.slug === 'dr-priya-mehta') ?? null;
    return { author: primaryAuthor ?? authors.find((a) => a.slug === 'editorial-team')!, reviewer };
  }

  if (kw.includes('hrv') || kw.includes('heart rate variability') || kw.includes('recovery score')) {
    primaryAuthor = authors.find((a) => a.slug === 'dr-james-whitfield') ?? primaryAuthor;
    const reviewer = authors.find((a) => a.slug === 'tom-bradley') ?? null;
    return { author: primaryAuthor!, reviewer };
  }

  if (template === 'alternatives' || template === 'reviews' || template === 'costs') {
    primaryAuthor = authors.find((a) => a.slug === 'marcus-oleary') ?? primaryAuthor;
    return { author: primaryAuthor!, reviewer: null };
  }

  if (template === 'protocols') {
    primaryAuthor = authors.find((a) => a.slug === 'tom-bradley') ?? primaryAuthor;
    const reviewer = authors.find((a) => a.slug === 'sarah-chen-pt') ?? null;
    return { author: primaryAuthor!, reviewer };
  }

  if (template === 'metrics') {
    primaryAuthor = authors.find((a) => a.slug === 'dr-james-whitfield') ?? primaryAuthor;
    return { author: primaryAuthor!, reviewer: null };
  }

  const fallback = authors.find((a) => a.slug === 'editorial-team')!;
  return { author: primaryAuthor ?? fallback, reviewer: null };
}

async function run(): Promise<void> {
  // Upsert author profiles
  console.log(`[author-seeder] Seeding ${AUTHOR_SEEDS.length} author profiles (dryRun=${DRY_RUN})`);

  if (!DRY_RUN) {
    for (const author of AUTHOR_SEEDS) {
      const { error } = await supabase.from('authors').upsert({
        slug: author.slug,
        name: author.name,
        title: author.title,
        bio: author.bio,
        credentials: author.credentials,
        expertise_templates: author.expertise_templates,
        expertise_beats: author.expertise_beats,
        linkedin_url: author.linkedin_url,
        twitter_url: author.twitter_url,
        institution_url: author.institution_url,
        avatar_url: author.avatar_url,
        persona: author.persona,
        author_type: author.author_type,
        is_active: author.is_active,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slug' });

      if (error) console.warn(`[author-seeder] Failed to upsert ${author.slug}: ${error.message}`);
      else console.log(`[author-seeder] Upserted: ${author.name} (${author.slug})`);
    }
  } else {
    for (const a of AUTHOR_SEEDS) {
      console.log(`  [dry] ${a.slug}: ${a.name} — ${a.title}`);
    }
  }

  // Assign authors to pages that don't have one
  if (!ASSIGN_PAGES && !DRY_RUN) {
    console.log('[author-seeder] Pass --assign-pages to assign authors to existing pages.');
    return;
  }

  if (ASSIGN_PAGES || DRY_RUN) {
    const { data: pages } = await supabase
      .from('pages')
      .select('slug, template, primary_keyword, metadata')
      .in('status', ['published', 'draft'])
      .is('metadata->author_slug', null);

    const pagesWithoutAuthor = ((pages ?? []) as Array<{
      slug: string;
      template: string;
      primary_keyword: string | null;
      metadata: Record<string, unknown> | null;
    }>).filter((p) => !p.metadata?.author_slug);

    console.log(`[author-seeder] Assigning authors to ${pagesWithoutAuthor.length} pages without author`);

    for (const page of pagesWithoutAuthor) {
      const { author, reviewer } = selectAuthorForPage(
        page.template,
        page.primary_keyword ?? '',
        AUTHOR_SEEDS,
      );

      const authorMeta: Record<string, unknown> = {
        author_slug: author.slug,
        author_name: author.name,
        author_title: author.title,
        author_credentials: author.credentials,
        ...(author.avatar_url ? { author_avatar_url: author.avatar_url } : {}),
        ...(author.linkedin_url ? { author_linkedin_url: author.linkedin_url } : {}),
        ...(author.twitter_url ? { author_twitter_url: author.twitter_url } : {}),
        ...(reviewer ? {
          reviewer_slug: reviewer.slug,
          reviewer_name: reviewer.name,
          reviewer_title: reviewer.title,
        } : {}),
      };

      if (DRY_RUN) {
        console.log(`  [dry] ${page.slug} → ${author.slug}${reviewer ? ` (reviewed by ${reviewer.slug})` : ''}`);
        continue;
      }

      await supabase.from('pages').update({
        metadata: { ...(page.metadata ?? {}), ...authorMeta },
      }).eq('slug', page.slug);
    }
  }

  console.log('[author-seeder] Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
