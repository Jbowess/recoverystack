import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { matchPartnerContact, normalizeDomain, PARTNER_CONTACT_SEEDS } from '@/lib/growth-engine';
import { isSmartRingKeyword } from '@/lib/market-focus';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function run() {
  console.log(`[partner-crm-sync] syncing ${PARTNER_CONTACT_SEEDS.length} partner contacts (dryRun=${DRY_RUN})`);
  let partnerTableAvailable = true;

  if (!DRY_RUN) {
    for (const seed of PARTNER_CONTACT_SEEDS) {
      const { error } = await supabase.from('partner_contacts').upsert({
        slug: seed.slug,
        name: seed.name,
        target_type: seed.targetType,
        domain: seed.domain,
        website_url: seed.websiteUrl,
        primary_channel: seed.primaryChannel,
        contact_email: seed.contactEmail,
        social_handle: seed.socialHandle,
        audience_fit: seed.audienceFit,
        niches: seed.niches,
        partnership_angles: seed.partnershipAngles,
        priority: seed.priority,
        notes: seed.notes ?? null,
        metadata: seed.metadata ?? {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slug' });

      if (error) {
        if (error.message.includes('partner_contacts')) {
          partnerTableAvailable = false;
          console.warn('[partner-crm-sync] partner_contacts missing - continuing without CRM persistence.');
          break;
        }
        console.warn(`[partner-crm-sync] ${seed.slug}: ${error.message}`);
      }
    }
  }

  const pagesResult = await supabase
    .from('pages')
    .select('id,slug,title,template,primary_keyword,meta_description')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(40);

  if (pagesResult.error) throw pagesResult.error;
  const pages = ((pagesResult.data ?? []) as Array<any>).filter((page) =>
    isSmartRingKeyword(`${page.title ?? ''} ${page.primary_keyword ?? ''} ${page.meta_description ?? ''}`),
  );

  let linked = 0;
  let outreachTableAvailable = true;
  for (const page of pages as Array<any>) {
    const matches = matchPartnerContact(page, PARTNER_CONTACT_SEEDS);
    for (const { contact, score } of matches.slice(0, 3)) {
      const row = {
        page_id: page.id,
        page_slug: page.slug,
        channel: 'affiliate_outreach',
        target_name: contact.name,
        target_domain: normalizeDomain(contact.websiteUrl) ?? contact.domain,
        target_type: contact.targetType,
        status: 'draft',
        angle: contact.partnershipAngles[0] ?? 'partner_enablement',
        subject: `RecoveryStack outreach: ${page.title}`,
        body: [
          `We created a page around ${page.title}.`,
          `It is relevant to ${contact.audienceFit}.`,
          `This could support ${contact.partnershipAngles.join(', ')}.`,
        ].join('\n\n'),
        cta_url: `${process.env.SITE_URL ?? 'https://recoverystack.io'}/${page.template}/${page.slug}`,
        metadata: {
          partner_contact_slug: contact.slug,
          partner_match_score: score,
          source: 'partner-crm-sync',
        },
      };

      linked += 1;
      if (DRY_RUN) {
        console.log(`[partner-crm-sync] ${page.slug} -> ${contact.slug} (${score})`);
        continue;
      }

      if (!outreachTableAvailable) {
        continue;
      }

      const { error } = await supabase.from('outreach_queue').upsert(row, {
        onConflict: 'page_slug,channel,target_name',
      });

      if (error) {
        if (error.message.includes('outreach_queue')) {
          outreachTableAvailable = false;
          console.warn('[partner-crm-sync] outreach_queue missing - skipping outreach persistence.');
          continue;
        }
        console.warn(`[partner-crm-sync] ${page.slug}/${contact.slug}: ${error.message}`);
      }
    }
  }

  console.log(`[partner-crm-sync] pages=${pages.length} linked=${linked} partnerTable=${partnerTableAvailable} outreachTable=${outreachTableAvailable} dryRun=${DRY_RUN}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
