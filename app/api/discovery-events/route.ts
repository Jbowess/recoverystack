import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { detectDiscoverySource } from '@/lib/llm-discovery';

const payloadSchema = z.object({
  source: z.string().trim().min(1).max(50).optional(),
  slug: z.string().trim().max(200).optional().nullable(),
  pageTemplate: z.string().trim().max(100).optional().nullable(),
  landingUrl: z.string().trim().url(),
  referrerUrl: z.string().trim().url().optional().nullable(),
  utmSource: z.string().trim().max(100).optional().nullable(),
  utmMedium: z.string().trim().max(100).optional().nullable(),
  utmCampaign: z.string().trim().max(120).optional().nullable(),
  sessionId: z.string().trim().max(120).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = payloadSchema.parse(json);
    const source = parsed.source && parsed.source !== 'unknown'
      ? parsed.source
      : detectDiscoverySource({ utmSource: parsed.utmSource, referrer: parsed.referrerUrl });

    if (source === 'unknown' || source === 'direct') {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    const { error } = await supabaseAdmin.from('llm_referral_events').insert({
      source,
      session_id: parsed.sessionId ?? null,
      slug: parsed.slug ?? null,
      page_template: parsed.pageTemplate ?? null,
      landing_url: parsed.landingUrl,
      referrer_url: parsed.referrerUrl ?? null,
      utm_source: parsed.utmSource ?? null,
      utm_medium: parsed.utmMedium ?? null,
      utm_campaign: parsed.utmCampaign ?? null,
      metadata: {
        route: 'api/discovery-events',
      },
    });

    if (error) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
