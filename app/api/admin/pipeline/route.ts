import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');

  if (action !== 'run_pipeline') {
    return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
  }

  try {
    const child = spawn('npm', ['run', 'daily:run'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });

    child.unref();
    return NextResponse.redirect(new URL('/admin?ok=pipeline_started', req.url), { status: 302 });
  } catch {
    return NextResponse.redirect(new URL('/admin?error=pipeline_start_failed', req.url), { status: 302 });
  }
}
