import 'server-only';
import { db } from './db';
import { decrypt, encrypt } from './crypto';
import { ApiError } from './errors';
import { refreshAccessToken } from './providers';
import { fetchMessageThread } from './providers/thread';
import { withProviderDeadline } from './providers/http';
import { messageDocument } from './email-document';
import type { WorkspaceId } from './workspace-selection';
import type { EmailThread } from '@/types/email-thread';

export async function getEmailThread(
  userId: string,
  workspace: WorkspaceId,
  id: string,
  images: boolean,
): Promise<EmailThread> {
  const email = await db.email.findFirst({
    where: { id, userId, workspace, account: { userId, workspace } },
    include: { account: true },
  });
  if (!email) throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
  try {
    return await withProviderDeadline(Date.now() + 20000, async () => {
      const account = email.account;
      let token = decrypt(account.accessToken);
      if (account.expiresAt.getTime() < Date.now() + 60000) {
        if (!account.refreshToken) throw new Error('Reconnect account');
        const refreshed = await refreshAccessToken(account.provider, decrypt(account.refreshToken));
        token = refreshed.accessToken;
        // Read requests do not acquire the mailbox mutation lease. Do not overwrite
        // credentials refreshed concurrently by sync or another reader.
        await db.emailAccount.updateMany({
          where: { id: account.id, userId, workspace, accessToken: account.accessToken },
          data: {
            accessToken: encrypt(token),
            expiresAt: new Date(refreshed.expiresAt),
            ...(refreshed.refreshToken ? { refreshToken: encrypt(refreshed.refreshToken) } : {}),
          },
        });
      }
      const thread = await fetchMessageThread(account.provider, token, email.providerMessageId);
      return {
        partial: thread.partial,
        messages: thread.messages.map(({ content, ...message }) => ({
          ...message,
          html: messageDocument(content, images, message.fallback),
        })),
      };
    });
  } catch {
    throw new ApiError(
      502,
      'THREAD_UNAVAILABLE',
      'The conversation could not be loaded. Try again.',
    );
  }
}
