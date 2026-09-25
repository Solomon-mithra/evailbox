import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { db } from './db';
import { ApiError } from './errors';
import { isDemo } from './env';
export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* Read-only server components refresh through proxy. */
        }
      },
    },
  });
}
export async function requireUser() {
  if (isDemo())
    throw new ApiError(503, 'DEMO_MODE', 'Live API is unavailable in the demo workspace.');
  const supabase = await supabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  const existing = await db.user.findUnique({ where: { id: user.id } });
  if (existing) return existing;
  try {
    return await db.user.create({ data: { id: user.id, email: user.email } });
  } catch (error) {
    // Two first requests may race to bootstrap the same trusted identity.
    if ((error as { code?: string }).code === 'P2002') {
      const created = await db.user.findUnique({ where: { id: user.id } });
      if (created) return created;
    }
    throw error;
  }
}
export function adminAuth() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
}

/** Server shell hydration only; private API handlers still call requireUser independently. */
export async function getShellUser() {
  if (isDemo()) return { id: 'demo-user', email: 'alex@example.com' };
  const { data, error } = await (await supabaseServer()).auth.getClaims();
  const claims = data?.claims;
  if (error || typeof claims?.sub !== 'string' || typeof claims.email !== 'string') return null;
  return { id: claims.sub, email: claims.email };
}
