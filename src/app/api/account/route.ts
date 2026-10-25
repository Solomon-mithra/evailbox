import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { route, ok, jsonBody } from '@/lib/errors';
import { getAccountOverview } from '@/lib/account-management';
import { accountPatch } from '@/lib/validation';
export const runtime = 'nodejs';
export const GET = route(async () => ok(await getAccountOverview((await requireUser()).id)));
export const PATCH = route(async (request) => {
  const user = await requireUser();
  const patch = accountPatch.parse(await jsonBody(request));
  await db.user.update({ where: { id: user.id }, data: patch });
  return ok(await getAccountOverview(user.id));
});
