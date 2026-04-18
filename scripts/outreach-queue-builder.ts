import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  buildAffiliateTargetUrl,
  buildOutreachAngle,
  buildTrackedUrl,
  extractBrandMentions,
  isDistributablePage,
  type DistributionPageInput,
} from '@/lib/distribution-engine';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const LIMIT = Number(process.env.OUTREACH_QUEUE_LIMIT ?? 40);

const GENERIC_TARGETS = [
  { target_name: 'wearable-affiliates', target_type: 'affiliate_network', target_domain: null },
  { target_name: 'creator-partners', target_type: 'creator', target_domain: null },
  { target_name: 'press-shortlist', target_type: 'press', target_domain: null },
] as const;

type ProductRow = {
  name: string | null;
  brand: string | null;
  affiliate_url: string | null;
};

function normalizeDomain(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function loadPublishedPages(limit: number) {
  const modern = await supabase
    .from('pages')
    .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,metadata,published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (modern.error?.message?.includes('metadata')) {
    const legacy = await supabase
      .from('pages')
      .select('id,slug,template,title,meta_description,intro,primary_keyword,body_json,published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (legacy.error) throw legacy.error;
    return (legacy.data ?? []).map((row) => ({ ...row, metadata: null }));
  }

  if (modern.error) throw modern.error;
  return modern.data ?? [];
}

async function run() {
  const [pages, productsResult] = await Promise.all([
    loadPublishedPages(LIMIT),
    supabase.from('products').select('name,brand,affiliate_url').limit(100),
  ]);

  if (productsResult.error) throw productsResult.error;

  const products = (productsResult.data ?? []) as ProductRow[];
  const relevantPages = (pages as DistributionPageInput[])
    .filter(isDistributablePage)
    .filter((page) => extractBrandMentions(page).length > 0);

  let queued = 0;

  for (const page of relevantPages) {
    const angle = buildOutreachAngle(page);
    const mentions = new Set(extractBrandMentions(page));
    let matchedTargets = 0;

    for (const product of products) {
      const brand = (product.brand ?? '').trim();
      const name = (product.name ?? '').trim();
      if (!brand && !name) continue;
      if (brand.toLowerCase() === 'recoverystack' || name.toLowerCase() === 'volo ring') continue;

      const lowerBrand = brand.toLowerCase();
      const lowerName = name.toLowerCase();
      if (!mentions.has(lowerBrand) && !mentions.has(lowerName.split(' ')[0])) continue;

      const targetUrl = buildTrackedUrl(
        `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
        'affiliate_outreach',
        'partner_email',
        page.slug,
      );

      const row = {
        page_id: page.id,
        page_slug: page.slug,
        channel: 'affiliate_outreach',
        target_name: name || brand,
        target_domain: normalizeDomain(product.affiliate_url) ?? null,
        target_type: 'brand',
        status: 'draft',
        angle,
        subject: `RecoveryStack coverage opportunity: ${page.title}`,
        body: [
          `We recently published a piece on ${page.title}.`,
          `It is framed around ${angle.replace(/_/g, ' ')} and targets buyers researching smart rings and recovery wearables.`,
          `If it is useful to your team, here is the page: ${targetUrl}`,
          `Direct product path: ${buildAffiliateTargetUrl()}`,
        ].join('\n\n'),
        cta_url: targetUrl,
        metadata: {
          target_brand: brand || null,
          source_page_template: page.template,
        },
      };

      matchedTargets += 1;
      queued += 1;
      if (DRY_RUN) {
        console.log(`[outreach-queue-builder] ${page.slug} -> ${row.target_name} (${row.angle})`);
        continue;
      }

      const { error: upsertError } = await supabase.from('outreach_queue').upsert(row, {
        onConflict: 'page_slug,channel,target_name',
      });

      if (upsertError) {
        console.warn(`[outreach-queue-builder] ${page.slug}/${row.target_name}: ${upsertError.message}`);
      }
    }

    if (matchedTargets === 0) {
      for (const genericTarget of GENERIC_TARGETS) {
        const targetUrl = buildTrackedUrl(
          `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
          'affiliate_outreach',
          genericTarget.target_type,
          page.slug,
        );

        const row = {
          page_id: page.id,
          page_slug: page.slug,
          channel: 'affiliate_outreach',
          target_name: genericTarget.target_name,
          target_domain: genericTarget.target_domain,
          target_type: genericTarget.target_type,
          status: 'draft',
          angle,
          subject: `RecoveryStack outreach angle: ${page.title}`,
          body: [
            `We published a page that is likely relevant to smart-ring and recovery-tech audiences: ${page.title}.`,
            `The angle is ${angle.replace(/_/g, ' ')} and is designed for buyers and operators comparing wearables.`,
            `Page link: ${targetUrl}`,
            `Product path: ${buildAffiliateTargetUrl()}`,
          ].join('\n\n'),
          cta_url: targetUrl,
          metadata: {
            source_page_template: page.template,
            generic_target: true,
          },
        };

        queued += 1;
        if (DRY_RUN) {
          console.log(`[outreach-queue-builder] ${page.slug} -> ${row.target_name} (${row.angle})`);
          continue;
        }

        const { error: upsertError } = await supabase.from('outreach_queue').upsert(row, {
          onConflict: 'page_slug,channel,target_name',
        });

        if (upsertError) {
          console.warn(`[outreach-queue-builder] ${page.slug}/${row.target_name}: ${upsertError.message}`);
        }
      }
    }
  }

  console.log(`[outreach-queue-builder] pages=${relevantPages.length} queued=${queued} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
