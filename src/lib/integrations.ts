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

export function requireDigestConfiguration() {
  if (!isConfigured(process.env.RESEND_API_KEY) || !isConfigured(process.env.DIGEST_FROM))
    throw new ApiError(503, 'DIGEST_NOT_CONFIGURED', 'Email digest delivery is not configured.');
}
