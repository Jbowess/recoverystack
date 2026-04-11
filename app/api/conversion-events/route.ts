import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveConversionVariant } from '@/lib/conversion-box';

const payloadSchema = z.object({
  variant: z.string().optional(),
  cta: z.string().trim().min(1).max(100),
  slug: z.string().trim().max(200).optional().nullable(),
  pageTemplate: z.string().trim().max(100).optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = payloadSchema.parse(json);

    const variant = resolveConversionVariant(parsed.variant ?? undefined);

    const { error } = await supabaseAdmin.from('conversion_events').insert({
      slug: parsed.slug ?? null,
      page_template: parsed.pageTemplate ?? null,
      variant,
      cta: parsed.cta,
    });

    if (error) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
