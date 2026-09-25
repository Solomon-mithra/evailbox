import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ReplyDraft } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { ApiError } from './errors';
import { withAccountCredentials } from './providers/credentials';
import { ProviderHttpError } from './providers/http';
import {
  applyProviderAction,
  fetchReplyContext,
  prepareProviderReply,
  sendProviderReply,
  reconcileProviderReply,
  ProviderActionUnknown,
  type ReplyMode,
  type MailboxAction,
  type ReplyContext,
} from './providers/actions';
import type { WorkspaceId } from './workspace-selection';
export const saveDraftSchema = z
  .object({
    body: z.string().max(16000),
    mode: z.enum(['reply', 'reply-all']),
    revision: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const sendDraftSchema = z
  .object({ draftId: z.string().min(1).max(100), revision: z.number().int().nonnegative() })
  .strict();
export interface ReplyDraftDTO {
  id: string;
  body: string;
  mode: ReplyMode;
  revision: number;
  status: string;
  lastError: string | null;
  updatedAt: string;
  acceptedAt: string | null;
}
export interface ReplyDraftResult {
  draft: ReplyDraftDTO | null;
  context: ReplyContext | null;
  account: { id: string; email: string; provider: string };
  notice: string | null;
}
function dto(draft: ReplyDraft): ReplyDraftDTO {
  return {
    id: draft.id,
    body: draft.body,
    mode: draft.mode as ReplyMode,
    revision: draft.revision,
    status: draft.status,
    lastError: draft.lastError,
    updatedAt: draft.updatedAt.toISOString(),
    acceptedAt: draft.acceptedAt?.toISOString() ?? null,
  };
}
async function ownedEmail(userId: string, workspace: WorkspaceId, id: string) {
  const email = await db.email.findFirst({
    where: { id, userId, workspace, account: { userId, workspace } },
    include: { account: true },
  });
  if (!email) throw new ApiError(404, 'NOT_FOUND', 'Email not found.');
  return email;
}
const scope = (userId: string, workspace: WorkspaceId, emailId: string, accountId: string) => ({
  userId,
  workspace,
  emailId,
  accountId,
});
function actionError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderHttpError && [401, 403].includes(error.status))
    return new ApiError(
      409,
      'RECONNECT_REQUIRED',
      'Reconnect this account from Accounts to allow replies and mailbox changes.',
    );
  if (error instanceof ProviderActionUnknown)
    return new ApiError(
      409,
      'ACTION_UNCONFIRMED',
      'The provider has not confirmed this change. Refresh or check your mailbox before trying again.',
    );
  return new ApiError(
    502,
    'PROVIDER_UNAVAILABLE',
    'Your email provider could not finish this request. Try again shortly.',
  );
}
export async function getReplyDraft(
  userId: string,
  workspace: WorkspaceId,
  emailId: string,
  mode?: ReplyMode,
): Promise<ReplyDraftResult> {
  const email = await ownedEmail(userId, workspace, emailId);
  const draft = await db.replyDraft.findFirst({
    where: scope(userId, workspace, emailId, email.accountId),
  });
  let context: ReplyContext | null = null,
    notice: string | null = null;
  try {
    context = await withAccountCredentials(userId, workspace, email.accountId, (account, token) =>
      fetchReplyContext(
        account.provider,
        token,
        email.providerMessageId,
        account.email,
        mode ?? (draft?.mode as ReplyMode) ?? 'reply',
      ),
    );
  } catch (error) {
    notice = actionError(error).message;
  }
  return {
    draft: draft ? dto(draft) : null,
    context,
    account: { id: email.accountId, email: email.account.email, provider: email.account.provider },
    notice,
  };
}
export async function saveReplyDraft(
  userId: string,
  workspace: WorkspaceId,
  emailId: string,
  value: unknown,
): Promise<ReplyDraftDTO> {
  const input = saveDraftSchema.parse(value),
    email = await ownedEmail(userId, workspace, emailId);
  const where = scope(userId, workspace, emailId, email.accountId);
  if (input.revision === null) {
    const draft = await db.replyDraft.create({
      data: {
        ...where,
        body: input.body,
        mode: input.mode,
        rfcMessageId: `<${randomUUID()}@evailbox.local>`,
      },
    });
    return dto(draft);
  }
  const result = await db.replyDraft.updateMany({
    where: { ...where, status: 'editing', revision: input.revision },
    data: { body: input.body, mode: input.mode, revision: { increment: 1 }, lastError: null },
  });
  if (!result.count)
    throw new ApiError(
      409,
      'DRAFT_CONFLICT',
      'This draft changed in another tab or is being sent. Reopen it before editing.',
    );
  const draft = await db.replyDraft.findFirst({ where });
  if (!draft) throw new ApiError(404, 'NOT_FOUND', 'Draft not found.');
  return dto(draft);
}
export async function sendReplyDraft(
  userId: string,
  workspace: WorkspaceId,
  emailId: string,
  value: unknown,
): Promise<ReplyDraftDTO> {
  const input = sendDraftSchema.parse(value),
    email = await ownedEmail(userId, workspace, emailId);
  const where = { ...scope(userId, workspace, emailId, email.accountId), id: input.draftId };
  let draft = await db.replyDraft.findFirst({ where });
  if (!draft) throw new ApiError(404, 'NOT_FOUND', 'Draft not found.');
  // The same draft identity is never sent again after acceptance or an uncertain attempt.
  if (draft.status !== 'editing') return dto(draft);
  if (draft.revision !== input.revision)
    throw new ApiError(409, 'DRAFT_CONFLICT', 'This draft changed. Reopen it before sending.');
  if (!draft.body.trim()) throw new ApiError(400, 'EMPTY_DRAFT', 'Write a reply before sending.');
  const leaseId = randomUUID();
  const claimed = await db.replyDraft.updateMany({
    where: { ...where, status: 'editing', revision: input.revision },
    data: {
      status: 'preparing',
      leaseId,
      leaseUntil: new Date(Date.now() + 120000),
      lastError: null,
    },
  });
  if (!claimed.count)
    throw new ApiError(409, 'DRAFT_CONFLICT', 'This draft is already being sent or changed.');
  let providerWriteStarted = false;
  try {
    await withAccountCredentials(userId, workspace, email.accountId, async (account, token) => {
      const context = await fetchReplyContext(
        account.provider,
        token,
        email.providerMessageId,
        account.email,
        draft!.mode as ReplyMode,
      );
      providerWriteStarted = true;
      const providerDraftId = await prepareProviderReply(
        account.provider,
        token,
        email.providerMessageId,
        draft!.mode as ReplyMode,
        context,
        draft!.body,
        draft!.rfcMessageId,
        draft!.providerDraftId,
        async (id) => {
          const saved = await db.replyDraft.updateMany({
            where: { ...where, leaseId, status: 'preparing' },
            data: { providerDraftId: id },
          });
          if (!saved.count)
            throw new ApiError(409, 'DRAFT_CONFLICT', 'This draft changed before sending.');
        },
      );
      const sending = await db.replyDraft.updateMany({
        where: { ...where, leaseId, status: 'preparing' },
        data: { status: 'sending', providerDraftId },
      });
      if (!sending.count)
        throw new ApiError(409, 'DRAFT_CONFLICT', 'This draft changed before sending.');
      const providerMessageId = await sendProviderReply(account.provider, token, providerDraftId);
      await db.replyDraft.updateMany({
        where: { ...where, leaseId },
        data: {
          status: 'accepted',
          providerMessageId,
          acceptedAt: new Date(),
          leaseId: null,
          leaseUntil: null,
          lastError: null,
        },
      });
    });
  } catch (error) {
    // Explicit 4xx means the provider rejected the operation. A new revision requires a fresh user Send.
    // Every other failure after a write began is ambiguous; automatic and manual send retries stay locked.
    const rejected =
      error instanceof ProviderHttpError && error.status >= 400 && error.status < 500;
    if (!providerWriteStarted || rejected) {
      const safe = actionError(error);
      await db.replyDraft.updateMany({
        where: { ...where, leaseId },
        data: {
          status: 'editing',
          revision: { increment: 1 },
          leaseId: null,
          leaseUntil: null,
          lastError: safe.message,
        },
      });
      throw safe;
    }
    await db.replyDraft.updateMany({
      where: { ...where, leaseId },
      data: {
        status: 'unknown',
        leaseId: null,
        leaseUntil: null,
        lastError:
          'The provider did not confirm this attempt. Check status before taking any further action. This draft will not be sent again automatically.',
      },
    });
  }
  draft = await db.replyDraft.findFirst({ where });
  if (!draft) throw new ApiError(404, 'NOT_FOUND', 'Draft not found.');
  return dto(draft);
}
export async function reconcileReplyDraft(
  userId: string,
  workspace: WorkspaceId,
  emailId: string,
): Promise<ReplyDraftDTO> {
  const email = await ownedEmail(userId, workspace, emailId),
    where = scope(userId, workspace, emailId, email.accountId);
  let draft = await db.replyDraft.findFirst({ where });
  if (!draft) throw new ApiError(404, 'NOT_FOUND', 'Draft not found.');
  if (draft.status === 'accepted' || draft.status === 'editing') return dto(draft);
  if (draft.leaseUntil && draft.leaseUntil.getTime() > Date.now())
    throw new ApiError(
      409,
      'SEND_PENDING',
      'This send is still being processed. Check again shortly.',
    );
  let result: Awaited<ReturnType<typeof reconcileProviderReply>>;
  try {
    result = await withAccountCredentials(userId, workspace, email.accountId, (account, token) =>
      reconcileProviderReply(account.provider, token, draft!.providerDraftId, draft!.rfcMessageId),
    );
  } catch (error) {
    throw actionError(error);
  }
  await db.replyDraft.updateMany({
    where: { ...where, id: draft.id, status: { in: ['preparing', 'sending', 'unknown'] } },
    data:
      result.status === 'accepted'
        ? {
            status: 'accepted',
            providerMessageId: result.providerMessageId,
            acceptedAt: new Date(),
            leaseId: null,
            leaseUntil: null,
            lastError: null,
          }
        : {
            status: 'unknown',
            leaseId: null,
            leaseUntil: null,
            lastError:
              'No sent copy is confirmed yet. Check your provider’s Sent and Drafts folders, then check status again. Sending remains disabled to prevent duplicates.',
          },
  });
  draft = await db.replyDraft.findFirst({ where });
  if (!draft) throw new ApiError(404, 'NOT_FOUND', 'Draft not found.');
  return dto(draft);
}
export async function changeMailboxMessage(
  userId: string,
  workspace: WorkspaceId,
  emailId: string,
  action: MailboxAction,
) {
  const email = await ownedEmail(userId, workspace, emailId);
  try {
    await withAccountCredentials(userId, workspace, email.accountId, async (account, token) => {
      await applyProviderAction(account.provider, token, email.providerMessageId, action);
      await db.email.updateMany({
        where: { id: emailId, userId, workspace, accountId: email.accountId },
        data: action === 'archive' ? { inInbox: false } : { isRead: action === 'read' },
      });
    });
  } catch (error) {
    throw actionError(error);
  }
  return { action, confirmed: true };
}
/** Safe summary listing: never return draft bodies to persistable inbox queries. */
export async function listReplyDrafts(userId: string, workspace: WorkspaceId) {
  const drafts = await db.replyDraft.findMany({
    where: { userId, workspace, account: { userId, workspace }, email: { userId, workspace } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      emailId: true,
      accountId: true,
      mode: true,
      status: true,
      updatedAt: true,
      account: { select: { email: true, provider: true } },
      email: { select: { subject: true, sender: true } },
    },
  });
  return drafts.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() }));
}
