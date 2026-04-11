import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';

const submissionSchema = z.object({
  email: z.string().email(),
  pageSlug: z.string().min(1).max(200),
  pageTemplate: z.string().min(1).max(100),
  answers: z.object({
    priority: z.enum(['sleep', 'stress', 'performance']),
    budget: z.enum(['low', 'medium', 'high']),
    wearableUsage: z.enum(['none', 'basic', 'daily']),
  }),
  score: z.number().int().min(0).max(100),
  recommendation: z.string().min(1).max(400),
  sourceUrl: z.string().url().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = submissionSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid submission payload.' }, { status: 400 });
  }

  const { email, pageSlug, pageTemplate, answers, score, recommendation, sourceUrl } = parsed.data;

  const { error } = await supabaseAdmin.from('compatibility_checker_submissions').insert({
    email,
    page_slug: pageSlug,
    page_template: pageTemplate,
    answers,
    score,
    recommendation,
    source_url: sourceUrl ?? null,
    user_agent: req.headers.get('user-agent'),
  });

  if (error) {
    return NextResponse.json({ error: 'Unable to save submission right now.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
