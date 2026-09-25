import { serve } from 'inngest/next';
import { inngest, backgroundConfigured } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';
export const runtime = 'nodejs';
export const maxDuration = 60;
const handlers = serve({ client: inngest, functions });
type Handler = (typeof handlers)['POST'];
function configured(handler: Handler): Handler {
  return (...args) =>
    backgroundConfigured()
      ? handler(...args)
      : Promise.resolve(
          Response.json({ error: 'Background processing is not configured' }, { status: 503 }),
        );
}
export const GET = configured(handlers.GET);
export const POST = configured(handlers.POST);
export const PUT = configured(handlers.PUT);
