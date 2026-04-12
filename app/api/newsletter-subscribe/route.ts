import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const subscribeSchema = z.object({
  email: z.string().email().max(320),
  source: z.enum(['newsletter_form', 'exit_intent']).default('newsletter_form'),
  pageTemplate: z.string().max(50).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const { email, source, pageTemplate } = parsed.data;

    // Upsert to avoid duplicates — update source/template if they resubscribe
    const { error } = await supabaseAdmin
      .from('newsletter_subscribers')
      .upsert(
        {
          email: email.toLowerCase(),
          source,
          page_template: pageTemplate ?? null,
          subscribed_at: new Date().toISOString(),
        },
        { onConflict: 'email' },
      );

    if (error) throw error;

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('Newsletter subscribe error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
