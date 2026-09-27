import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { planIds } from '@/lib/plans';
import { createCheckout } from '@/lib/billing/service';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  const user = await requireUser();
  const { planId } = z
    .object({ planId: z.enum(planIds) })
    .strict()
    .parse(await jsonBody(request));
  return ok(await createCheckout(user.id, planId));
});
