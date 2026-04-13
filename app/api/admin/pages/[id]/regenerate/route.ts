import { spawn } from 'node:child_process';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';

function runSinglePageGeneration(pageId: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/content-generator.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONTENT_GENERATE_PAGE_ID: pageId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `content-generator exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const form = await req.formData();
  const action = String(form.get('action') ?? '');
  const { id } = await params;

  if (action !== 'regenerate') {
    return NextResponse.redirect(new URL('/admin?error=invalid_action', req.url), { status: 302 });
  }

  const { data: page } = await supabaseAdmin.from('pages').select('id,slug,template').eq('id', id).single();
  if (!page) {
    return NextResponse.redirect(new URL('/admin?error=page_not_found', req.url), { status: 302 });
  }

  try {
    await runSinglePageGeneration(page.id);
    revalidatePath(`/${page.template}/${page.slug}`);

    await supabaseAdmin
      .from('content_refresh_queue')
      .update({ status: 'completed', processed_at: new Date().toISOString() })
      .eq('page_id', page.id)
      .in('status', ['approved', 'queued']);

    await logAdminAction({ action: 'regenerate_page', target_type: 'page', target_id: id, metadata: { slug: page.slug, template: page.template } });
    return NextResponse.redirect(new URL('/admin?ok=page_regenerated', req.url), { status: 302 });
  } catch (err) {
    await logAdminAction({ action: 'regenerate_page', target_type: 'page', target_id: id, metadata: { slug: page.slug, error: err instanceof Error ? err.message : String(err) } });
    return NextResponse.redirect(new URL('/admin?error=page_regenerate_failed', req.url), { status: 302 });
  }
}
