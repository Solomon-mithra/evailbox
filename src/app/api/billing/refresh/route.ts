import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { refreshBilling } from '@/lib/billing/service';
import { getAccountOverview } from '@/lib/account-management';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  const user = await requireUser();
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  await refreshBilling(user.id);
  return ok(await getAccountOverview(user.id));
});
