import 'server-only';
import { cookies } from 'next/headers';
import { db } from './db';
import { ApiError } from './errors';
import { isDemo } from './env';
import { SESSION_COOKIE, passwordProtected, verifySessionToken } from './session';

/** Self-hosted: one owner. A valid UUID keeps existing userId validation intact. */
export const LOCAL_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@localhost',
} as const;

async function signedIn() {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireUser() {
  if (isDemo())
    throw new ApiError(503, 'DEMO_MODE', 'Live API is unavailable in the demo workspace.');
  if (!(await signedIn())) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return db.user.upsert({
    where: { id: LOCAL_USER.id },
    create: { ...LOCAL_USER },
    update: {},
  });
}

/** Server shell hydration only; private API handlers still call requireUser independently. */
export async function getShellUser() {
  if (isDemo()) return { id: 'demo-user', email: 'alex@example.com', canSignOut: false };
  if (!(await signedIn())) return null;
  return { ...LOCAL_USER, canSignOut: passwordProtected() };
}
