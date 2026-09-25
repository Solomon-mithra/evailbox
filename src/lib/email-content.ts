import 'server-only';
import { db } from './db';
import { decrypt, encrypt } from './crypto';
import { ApiError } from './errors';
import { refreshAccessToken } from './providers';
import { fetchMessageContent, type MessageContent } from './providers/content';
import { withProviderDeadline } from './providers/http';
import { messageDocument, messageHeaders } from './email-document';
import type { WorkspaceId } from './workspace-selection';

export async function emailContentResponse(
  userId: string,
  workspace: WorkspaceId,
  id: string,
  images: boolean,
) {
  const email = await db.email.findFirst({
    where: { id, userId, workspace, account: { userId, workspace } },
    include: { account: true },
  });
  if (!email) throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
  let message: MessageContent = {
    format: 'text',
    content: email.body || email.snippet || 'No preview available.',
  };
  let fallback = false;
  try {
    message = await withProviderDeadline(Date.now() + 20000, async () => {
      const account = email.account;
      let token = decrypt(account.accessToken);
      if (account.expiresAt.getTime() < Date.now() + 60000) {
        if (!account.refreshToken) throw new Error('Reconnect account');
        const refreshed = await refreshAccessToken(account.provider, decrypt(account.refreshToken));
        token = refreshed.accessToken;
        // A concurrent sync may have refreshed already; do not overwrite its newer token.
        await db.emailAccount.updateMany({
          where: { id: account.id, userId, accessToken: account.accessToken },
          data: {
            accessToken: encrypt(token),
            expiresAt: new Date(refreshed.expiresAt),
            ...(refreshed.refreshToken ? { refreshToken: encrypt(refreshed.refreshToken) } : {}),
          },
        });
      }
      return fetchMessageContent(account.provider, token, email.providerMessageId);
    });
  } catch {
    fallback = true;
  }
  return new Response(messageDocument(message, images, fallback), {
    headers: messageHeaders(images),
  });
}
