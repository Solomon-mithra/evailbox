import { z } from 'zod';
const present = z
  .string()
  .min(1)
  .refine((v) => !v.includes('replace-with') && !v.includes('your-project'), 'Replace placeholder');
const common = z.object({
  APP_MODE: z.enum(['demo', 'live']).default('live'),
  NEXT_PUBLIC_APP_URL: z.url(),
});
const live = common.extend({
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine((v) => !v.includes('your-project')),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: present,
  SUPABASE_SERVICE_ROLE_KEY: present,
  DATABASE_URL: z.string().startsWith('postgres'),
  DIRECT_URL: z.string().startsWith('postgres'),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: present,
  GOOGLE_CLIENT_SECRET: present,
  NEXT_PUBLIC_MICROSOFT_CLIENT_ID: present,
  MICROSOFT_CLIENT_SECRET: present,
  JEV_GATEWAY_URL: z.url(),
  JEV_API_KEY: present,
  ENCRYPTION_SECRET_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  CRON_SECRET: present.min(32),
  VAPID_PUBLIC_KEY: present,
  VAPID_PRIVATE_KEY: present,
  VAPID_SUBJECT: present,
  RESEND_API_KEY: present,
  DIGEST_FROM: present,
});
export function validateEnv(source: Record<string, string | undefined> = process.env) {
  const base = common.safeParse(source);
  const result = base.success && base.data.APP_MODE === 'demo' ? base : live.safeParse(source);
  if (!result.success)
    throw new Error(
      `Invalid environment: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return result.data;
}
export function isDemo() {
  return process.env.APP_MODE === 'demo';
}
