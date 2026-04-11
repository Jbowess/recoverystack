import { createClient } from '@supabase/supabase-js';
import { assertRuntimeEnv } from '@/lib/runtime-env';

assertRuntimeEnv('supabase admin client initialization');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
