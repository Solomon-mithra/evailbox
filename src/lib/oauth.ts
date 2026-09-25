import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, after } from 'next/server';
import { createOAuthState, verifyOAuthState, constantTimeEqual, encrypt } from './crypto';
import { exchangeCode, getAuthorizationUrl, getMailboxIdentity, type Provider } from './providers';
import { requestWork } from './work-queue';
import { requestMailboxSubscriptionRenewal } from './mailbox-subscriptions';
import { publishUserWork } from './inngest/dispatch';
import { db } from './db';
import { ApiError } from './errors';
import type { WorkspaceId } from './workspace-selection';
const callback = (provider: Provider) =>
  `${process.env.NEXT_PUBLIC_APP_URL}/api/accounts/${provider.toLowerCase()}/callback`;
export async function beginConnection(
  provider: Provider,
  userId: string,
  workspace: WorkspaceId = 'PERSONAL',
) {
  const verifier = randomBytes(32).toString('base64url');
  const state = createOAuthState(userId, provider, verifier, Date.now(), workspace);
  const authorizationUrl = getAuthorizationUrl(provider, {
    state,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    redirectUri: callback(provider),
  });
  const jar = await cookies();
  jar.set(`jev_oauth_${provider}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: `/api/accounts/${provider.toLowerCase()}/callback`,
  });
  return NextResponse.redirect(authorizationUrl);
}
export async function finishConnection(provider: Provider, userId: string, url: URL) {
  const state = url.searchParams.get('state'),
    code = url.searchParams.get('code');
  const jar = await cookies();
  const saved = jar.get(`jev_oauth_${provider}`)?.value;
  jar.set(`jev_oauth_${provider}`, '', {
    maxAge: 0,
    path: `/api/accounts/${provider.toLowerCase()}/callback`,
  });
  if (!state || !saved || !constantTimeEqual(state, saved) || !code)
    throw new ApiError(400, 'OAUTH_STATE', 'The connection expired. Please try again.');
  const { verifier, workspace } = verifyOAuthState(state, userId, provider);
  const tokens = await exchangeCode(provider, {
    code,
    codeVerifier: verifier,
    redirectUri: callback(provider),
  });
  const identity = await getMailboxIdentity(provider, tokens.accessToken);
  const email = identity.email.toLowerCase();
  const existing = await db.emailAccount.findUnique({
    where: { userId_workspace_provider_email: { userId, workspace, provider, email } },
  });
  if (!tokens.refreshToken && !existing?.refreshToken)
    throw new ApiError(
      400,
      'OFFLINE_ACCESS_REQUIRED',
      'Reconnect and grant offline access to enable syncing.',
    );
  const account = await db.emailAccount.upsert({
    where: { userId_workspace_provider_email: { userId, workspace, provider, email } },
    create: {
      userId,
      workspace,
      provider,
      email,
      accessToken: encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      expiresAt: new Date(tokens.expiresAt),
    },
    update: {
      accessToken: encrypt(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshToken: encrypt(tokens.refreshToken) } : {}),
      expiresAt: new Date(tokens.expiresAt),
      syncError: null,
    },
  });
  await requestMailboxSubscriptionRenewal(userId, account.id, workspace);
  await requestWork(userId, { sync: true, workspace });
  after(async () => {
    await publishUserWork(userId);
  });
  return NextResponse.redirect(
    new URL('/accounts?connected=1&workspace=' + workspace, process.env.NEXT_PUBLIC_APP_URL),
  );
}
