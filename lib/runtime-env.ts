export const REQUIRED_RUNTIME_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REVALIDATE_SECRET',
  'CRON_SECRET',
  'ADMIN_PASSWORD',
] as const;

export type RuntimeEnvVar = (typeof REQUIRED_RUNTIME_ENV_VARS)[number];

export type RuntimeEnvValidationResult = {
  ok: boolean;
  missing: RuntimeEnvVar[];
  missingAnyOf: string[][];
};

function isMissing(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

export function validateRuntimeEnv(
  requiredVars: readonly RuntimeEnvVar[] = REQUIRED_RUNTIME_ENV_VARS,
): RuntimeEnvValidationResult {
  const missing = requiredVars.filter((name) => isMissing(process.env[name])) as RuntimeEnvVar[];
  const missingAnyOf = [
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  ].filter((group) => group.every((name) => isMissing(process.env[name])));

  return { ok: missing.length === 0 && missingAnyOf.length === 0, missing, missingAnyOf };
}

export function assertRuntimeEnv(context = 'startup'): void {
  const result = validateRuntimeEnv();

  if (result.ok) return;

  const joined = [
    ...result.missing,
    ...result.missingAnyOf.map((group) => `one of: ${group.join(' | ')}`),
  ].join(', ');
  throw new Error(
    `[env] Missing required runtime environment variable(s) for ${context}: ${joined}. ` +
      'Set these in your deployment environment (for example Vercel Project Settings → Environment Variables) and restart the app.',
  );
}
