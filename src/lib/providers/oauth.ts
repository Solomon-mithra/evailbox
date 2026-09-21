import 'server-only';
import { z } from 'zod';
import { authHeaders, requestJson, requiredEnv } from './http';
import type { Provider, TokenSet } from './types';
const scopes = {
  GMAIL: 'https://www.googleapis.com/auth/gmail.readonly',
  OUTLOOK: 'offline_access Mail.Read User.Read',
};
function config(provider: Provider) {
  if (provider === 'GMAIL')
    return {
      clientId: requiredEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID'),
      secretName: 'GOOGLE_CLIENT_SECRET',
      authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
    };
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new Error('Invalid Microsoft tenant');
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  return {
    clientId: requiredEnv('NEXT_PUBLIC_MICROSOFT_CLIENT_ID'),
    secretName: 'MICROSOFT_CLIENT_SECRET',
    authorization: `${base}/authorize`,
    token: `${base}/token`,
  };
}
export function getAuthorizationUrl(
  provider: Provider,
  options: { state: string; codeChallenge: string; redirectUri: string },
): string {
  const settings = config(provider);
  const url = new URL(settings.authorization);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    scope: scopes[provider],
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    ...(provider === 'GMAIL'
      ? { access_type: 'offline', prompt: 'consent' }
      : { response_mode: 'query' }),
  }).toString();
  return url.toString();
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().finite(),
});
async function tokenRequest(provider: Provider, fields: Record<string, string>): Promise<TokenSet> {
  const settings = config(provider);
  const result = tokenSchema.parse(
    await requestJson(settings.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: requiredEnv(settings.secretName),
        ...fields,
      }).toString(),
    }),
  );
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
}
export function exchangeCode(
  provider: Provider,
  options: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenSet> {
  return tokenRequest(provider, {
    grant_type: 'authorization_code',
    code: options.code,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri,
  });
}
export function refreshAccessToken(provider: Provider, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(provider, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    ...(provider === 'OUTLOOK' ? { scope: scopes.OUTLOOK } : {}),
  });
}
export async function getMailboxIdentity(
  provider: Provider,
  accessToken: string,
): Promise<{ email: string }> {
  const result = await requestJson(
    provider === 'GMAIL'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
    { headers: authHeaders(accessToken) },
  );
  const email =
    provider === 'GMAIL'
      ? z.object({ emailAddress: z.string() }).parse(result).emailAddress
      : (() => {
          const identity = z
            .object({
              mail: z.string().nullable().optional(),
              userPrincipalName: z.string().optional(),
            })
            .parse(result);
          return identity.mail || identity.userPrincipalName;
        })();
  return { email: z.email().parse(email).toLowerCase() };
}
