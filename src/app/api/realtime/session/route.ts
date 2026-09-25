import { requireUser, supabaseServer } from '@/lib/auth';
import { route, ok, ApiError } from '@/lib/errors';
export const runtime = 'nodejs';
export const GET = route(async () => {
  const user = await requireUser();
  // getSession is used only AFTER server verification, to provide a short-lived Realtime JWT.
  const {
    data: { session },
    error,
  } = await (await supabaseServer()).auth.getSession();
  if (error || !session || session.user.id !== user.id)
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return ok({
    userId: user.id,
    accessToken: session.access_token,
    expiresAt: (session.expires_at ?? 0) * 1000,
    url: process.env.SUPABASE_URL!,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
  });
});
