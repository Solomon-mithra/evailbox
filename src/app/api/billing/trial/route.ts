import { z } from 'zod';
import { after } from 'next/server';
import { requireUser } from '@/lib/auth';
import { route, ok, jsonBody } from '@/lib/errors';
import { getAccountOverview } from '@/lib/account-management';
import { startTrial } from '@/lib/billing/service';
import { publishUserWork } from '@/lib/inngest/dispatch';
export const runtime = 'nodejs';
export const POST = route(async (request) => {
  const user = await requireUser();
  z.object({})
    .strict()
    .parse(await jsonBody(request));
  await startTrial(user.id);
  after(() => publishUserWork(user.id));
  return ok(await getAccountOverview(user.id));
});
