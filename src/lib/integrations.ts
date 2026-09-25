import 'server-only';
import { isConfigured } from './env';
import { ApiError } from './errors';

export function requireOutlookConfiguration() {
  if (
    !isConfigured(process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID) ||
    !isConfigured(process.env.MICROSOFT_CLIENT_SECRET)
  )
    throw new ApiError(503, 'OUTLOOK_NOT_CONFIGURED', 'Outlook connection is not configured.');
}
