import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { createPortal } from '@/lib/billing/service';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  const user = await requireUser();
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  return ok(await createPortal(user.id));
});
