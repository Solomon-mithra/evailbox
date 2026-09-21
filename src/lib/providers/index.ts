import 'server-only';
import { fetchGmailPage } from './gmail';
import { fetchOutlookPage } from './outlook';
import type { Provider, SyncPage } from './types';
export type { Provider, ProviderEmail, SyncPage, TokenSet } from './types';
export { exchangeCode, getAuthorizationUrl, getMailboxIdentity, refreshAccessToken } from './oauth';
export { ProviderHttpError } from './http';
export function fetchEmailPage(
  provider: Provider,
  accessToken: string,
  cursor: string | null,
): Promise<SyncPage> {
  if (cursor && cursor.length > 40000) throw new Error('Invalid sync cursor');
  return provider === 'GMAIL'
    ? fetchGmailPage(accessToken, cursor)
    : fetchOutlookPage(accessToken, cursor);
}
