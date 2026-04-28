import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveConversionVariant } from '@/lib/conversion-box';

const payloadSchema = z.object({
  variant: z.string().optional(),
  cta: z.string().trim().min(1).max(100),
  slug: z.string().trim().max(200).optional().nullable(),
  pageTemplate: z.string().trim().max(100).optional().nullable(),
  discoverySource: z.string().trim().max(50).optional().nullable(),
  referrerUrl: z.string().trim().url().optional().nullable(),
  landingUrl: z.string().trim().url().optional().nullable(),
  utmSource: z.string().trim().max(100).optional().nullable(),
  utmMedium: z.string().trim().max(100).optional().nullable(),
  utmCampaign: z.string().trim().max(120).optional().nullable(),
  sessionId: z.string().trim().max(120).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = payloadSchema.parse(json);

    const variant = resolveConversionVariant(parsed.variant ?? undefined);

    const { error } = await supabaseAdmin.from('seo_conversion_events').insert({
      slug: parsed.slug ?? null,
      page_template: parsed.pageTemplate ?? null,
      variant,
      cta: parsed.cta,
      discovery_source: parsed.discoverySource ?? null,
      referrer_url: parsed.referrerUrl ?? null,
      landing_url: parsed.landingUrl ?? null,
      utm_source: parsed.utmSource ?? null,
      utm_medium: parsed.utmMedium ?? null,
      utm_campaign: parsed.utmCampaign ?? null,
      session_id: parsed.sessionId ?? null,
      metadata: {},
    });

    if (error) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
