import type { PageRecord } from '@/lib/types';

const SITE_URL = process.env.SITE_URL ?? 'https://recoverystack.io';

export type EditorialProfile = {
  slug: string;
  name: string;
  title: string;
  bio?: string | null;
  credentials?: string[] | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  avatar_url?: string | null;
};

export type EditorialMetadata = {
  author: EditorialProfile;
  reviewer: EditorialProfile | null;
  trustSignals: string[];
};

const DEFAULT_AUTHOR: EditorialProfile = {
  slug: 'editorial-team',
  name: 'RecoveryStack Editorial Team',
  title: 'Sports Science & Recovery Technology Analysts',
  credentials: ['Sports Science', 'Exercise Physiology', 'Health Technology'],
};

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return out.length ? out : null;
}

export function getEditorialMetadata(page: Pick<PageRecord, 'metadata' | 'template' | 'published_at' | 'updated_at'>): EditorialMetadata {
  const meta = page.metadata ?? {};

  const author: EditorialProfile = {
    slug: readString(meta.author_slug, DEFAULT_AUTHOR.slug),
    name: readString(meta.author_name, DEFAULT_AUTHOR.name),
    title: readString(meta.author_title, DEFAULT_AUTHOR.title),
    bio: readOptionalString(meta.author_bio),
    credentials: readStringArray(meta.author_credentials) ?? DEFAULT_AUTHOR.credentials ?? null,
    linkedin_url: readOptionalString(meta.author_linkedin_url),
    twitter_url: readOptionalString(meta.author_twitter_url),
    avatar_url: readOptionalString(meta.author_avatar_url),
  };

  const reviewerSlug = readOptionalString(meta.reviewer_slug);
  const reviewerName = readOptionalString(meta.reviewer_name);

  const reviewer: EditorialProfile | null =
    reviewerSlug || reviewerName
      ? {
          slug: reviewerSlug ?? DEFAULT_AUTHOR.slug,
          name: reviewerName ?? DEFAULT_AUTHOR.name,
          title: readString(meta.reviewer_title, 'Clinical and Evidence Review'),
          bio: readOptionalString(meta.reviewer_bio),
          credentials: readStringArray(meta.reviewer_credentials),
          linkedin_url: readOptionalString(meta.reviewer_linkedin_url),
          twitter_url: readOptionalString(meta.reviewer_twitter_url),
          avatar_url: readOptionalString(meta.reviewer_avatar_url),
        }
      : null;

  const trustSignals = [
    author.credentials?.[0] ? `${author.credentials[0]} reviewed` : 'Editorially reviewed',
    reviewer ? `Reviewed by ${reviewer.name}` : 'Evidence-backed references',
    page.template === 'reviews' || page.template === 'alternatives' ? 'Testing methodology included' : 'People-first guidance',
  ];

  return { author, reviewer, trustSignals };
}

export function toPersonReference(profile: EditorialProfile) {
  return {
    '@type': 'Person' as const,
    name: profile.name,
    url: `${SITE_URL}/authors/${profile.slug}`,
    jobTitle: profile.title,
    sameAs: [profile.linkedin_url, profile.twitter_url].filter(Boolean),
  };
}
