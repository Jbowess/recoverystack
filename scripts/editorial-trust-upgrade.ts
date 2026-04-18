import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildEditorialTrustMetadata, EDITORIAL_TRUST_SEEDS } from '@/lib/growth-engine';
import { assessTrendRelevance } from '@/lib/trend-relevance';
import { isSmartRingKeyword } from '@/lib/market-focus';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function loadPages(limit: number) {
  const modern = await supabase
    .from('pages')
    .select('id,slug,template,primary_keyword,metadata,body_json,status,updated_at')
    .in('status', ['draft', 'approved', 'published'])
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (modern.error?.message?.includes('metadata')) {
    const legacy = await supabase
      .from('pages')
      .select('id,slug,template,primary_keyword,body_json,status,updated_at')
      .in('status', ['draft', 'approved', 'published'])
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []).map((row) => ({ ...row, metadata: null }));
  }

  if (modern.error) throw modern.error;
  return modern.data ?? [];
}

async function run() {
  const metadataProbe = await supabase.from('pages').select('metadata').limit(1);
  const supportsPageMetadata = !metadataProbe.error;

  if (!DRY_RUN) {
    for (const seed of EDITORIAL_TRUST_SEEDS) {
      const { error } = await supabase.from('editorial_trust_profiles').upsert({
        slug: seed.slug,
        label: seed.label,
        profile_type: seed.profileType,
        applies_to_templates: seed.appliesToTemplates,
        evidence_requirements: seed.evidenceRequirements,
        review_steps: seed.reviewSteps,
        trust_signals: seed.trustSignals,
        metadata: seed.metadata ?? {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slug' });

      if (error) {
        console.warn(`[editorial-trust-upgrade] profile ${seed.slug}: ${error.message}`);
      }
    }
  }

  const pages = await loadPages(120);
  const relevantPages = (pages as Array<any>).filter((page) => {
    const focus = `${page.slug ?? ''} ${page.primary_keyword ?? ''}`.trim();
    return isSmartRingKeyword(focus) || assessTrendRelevance(focus).relevant;
  });
  let updated = 0;

  for (const page of relevantPages) {
    const metadata = buildEditorialTrustMetadata(page);
    const bodyJson = page.body_json ?? {};
    const reviewMethodology = (bodyJson.review_methodology ?? {
      summary: 'RecoveryStack applies a buyer-first wearable review standard with spec verification, pricing checks, and explicit tradeoff disclosure.',
      tested: ['product truth verification', 'pricing audit', 'fit/use-case review'],
      scoring: ['battery', 'sleep/recovery usefulness', 'subscription burden', 'platform compatibility'],
      use_cases: ['athletes', 'sleep-focused buyers', 'recovery-first users'],
    });

    updated += 1;
    if (DRY_RUN) {
      console.log(`[editorial-trust-upgrade] ${page.slug} -> ${String(metadata.trust_profile_slug)}`);
      continue;
    }

    const updatePayload = supportsPageMetadata
      ? {
          metadata,
          body_json: {
            ...bodyJson,
            review_methodology: reviewMethodology,
          },
        }
      : {
          body_json: {
            ...bodyJson,
            review_methodology: reviewMethodology,
          },
        };

    const { error } = await supabase.from('pages').update(updatePayload).eq('id', page.id);

    if (error) {
      console.warn(`[editorial-trust-upgrade] ${page.slug}: ${error.message}`);
    }
  }

  console.log(`[editorial-trust-upgrade] pages=${relevantPages.length} updated=${updated} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
