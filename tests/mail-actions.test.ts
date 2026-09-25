import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  draftFind: vi.fn(),
  draftCreate: vi.fn(),
  draftUpdate: vi.fn(),
  emailUpdate: vi.fn(),
  credentials: vi.fn(),
  context: vi.fn(),
  prepare: vi.fn(),
  send: vi.fn(),
  reconcile: vi.fn(),
  action: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    email: { findFirst: mocks.email, updateMany: mocks.emailUpdate },
    replyDraft: {
      findFirst: mocks.draftFind,
      create: mocks.draftCreate,
      updateMany: mocks.draftUpdate,
    },
  },
}));
vi.mock('@/lib/providers/credentials', () => ({ withAccountCredentials: mocks.credentials }));
vi.mock('@/lib/providers/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/actions')>()),
  fetchReplyContext: mocks.context,
  prepareProviderReply: mocks.prepare,
  sendProviderReply: mocks.send,
  reconcileProviderReply: mocks.reconcile,
  applyProviderAction: mocks.action,
}));
import {
  getReplyDraft,
  saveReplyDraft,
  sendReplyDraft,
  reconcileReplyDraft,
  changeMailboxMessage,
} from '../src/lib/mail-actions';
import { ProviderActionUnknown } from '../src/lib/providers/actions';
import { ProviderHttpError } from '../src/lib/providers/http';
const account = { id: 'account', email: 'me@example.com', provider: 'GMAIL' };
const email = {
  id: 'email',
  accountId: 'account',
  userId: 'owner',
  workspace: 'WORK',
  providerMessageId: 'original',
  account,
};
let draft: Record<string, unknown>;
const reply = {
  from: 'me@example.com',
  to: ['sender@example.com'],
  cc: [],
  subject: 'Re: Subject',
  threadId: 'thread',
};
beforeEach(() => {
  vi.resetAllMocks();
  draft = {
    id: 'draft',
    userId: 'owner',
    workspace: 'WORK',
    accountId: 'account',
    emailId: 'email',
    mode: 'reply',
    body: 'My reply',
    revision: 2,
    status: 'editing',
    rfcMessageId: '<stable@evailbox.local>',
    providerDraftId: null,
    providerMessageId: null,
    leaseId: null,
    leaseUntil: null,
    lastError: null,
    acceptedAt: null,
    updatedAt: new Date(),
  };
  mocks.email.mockResolvedValue(email);
  mocks.draftFind.mockImplementation(async () => ({ ...draft }));
  mocks.draftUpdate.mockImplementation(async ({ where, data }) => {
    if (
      where.status &&
      (typeof where.status === 'string'
        ? draft.status !== where.status
        : !where.status.in.includes(draft.status))
    )
      return { count: 0 };
    if (where.revision !== undefined && draft.revision !== where.revision) return { count: 0 };
    if (where.leaseId && draft.leaseId !== where.leaseId) return { count: 0 };
    Object.assign(draft, data, {
      revision: data.revision?.increment
        ? Number(draft.revision) + data.revision.increment
        : (data.revision ?? draft.revision),
    });
    return { count: 1 };
  });
  mocks.credentials.mockImplementation(async (_u, _w, _a, fn) => fn(account, 'token'));
  mocks.context.mockResolvedValue(reply);
  mocks.prepare.mockImplementation(async (_p, _t, _o, _m, _c, _b, _r, _d, onCreated) => {
    if (onCreated) await onCreated('provider-draft');
    return 'provider-draft';
  });
  mocks.send.mockResolvedValue('provider-sent');
  mocks.emailUpdate.mockResolvedValue({ count: 1 });
});
describe('tenant-scoped durable reply actions', () => {
  it('denies a foreign message before any provider or draft read', async () => {
    mocks.email.mockResolvedValue(null);
    await expect(getReplyDraft('owner', 'WORK', 'foreign')).rejects.toMatchObject({ status: 404 });
    expect(mocks.draftFind).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'foreign',
          userId: 'owner',
          workspace: 'WORK',
          account: { userId: 'owner', workspace: 'WORK' },
        },
      }),
    );
  });
  it('returns a saved draft body even when provider context is temporarily unavailable, without tokens or provider ids', async () => {
    mocks.context.mockRejectedValue(new Error('private details'));
    const result = await getReplyDraft('owner', 'WORK', 'email');
    expect(result.draft?.body).toBe('My reply');
    expect(result.context).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private details');
    expect(JSON.stringify(result)).not.toContain('stable@');
  });
  it('rejects stale save revisions instead of overwriting newer draft edits', async () => {
    await expect(
      saveReplyDraft('owner', 'WORK', 'email', { body: 'stale text', mode: 'reply', revision: 1 }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(draft.body).toBe('My reply');
  });
  it('stores RFC identity at creation before any provider draft or send', async () => {
    mocks.draftFind.mockResolvedValue(null);
    mocks.draftCreate.mockImplementation(async ({ data }) => ({ ...draft, ...data }));
    await saveReplyDraft('owner', 'WORK', 'email', { body: 'new', mode: 'reply', revision: null });
    expect(mocks.draftCreate.mock.calls[0][0].data).toMatchObject({
      userId: 'owner',
      workspace: 'WORK',
      accountId: 'account',
      emailId: 'email',
      rfcMessageId: expect.stringMatching(/^<.+@evailbox\.local>$/),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('atomically claims a saved revision so simultaneous sends reach the provider once', async () => {
    const results = await Promise.allSettled([
      sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
      sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(draft.status).toBe('accepted');
    expect(mocks.send.mock.calls[0]).toEqual(['GMAIL', 'token', 'provider-draft']);
    const saved = mocks.draftUpdate.mock.calls.find(
      (c) => c[0].data.providerDraftId === 'provider-draft',
    );
    expect(saved).toBeTruthy();
    await sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('records unknown on lost send response and only reads during reconciliation', async () => {
    mocks.send.mockRejectedValue(new ProviderActionUnknown());
    expect(
      (await sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 })).status,
    ).toBe('unknown');
    await sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    mocks.reconcile.mockResolvedValue({ status: 'accepted', providerMessageId: 'found-sent' });
    expect((await reconcileReplyDraft('owner', 'WORK', 'email')).status).toBe('accepted');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('keeps ambiguous provider creation locked rather than creating a second draft', async () => {
    mocks.prepare.mockRejectedValue(new ProviderActionUnknown());
    expect(
      (await sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 })).status,
    ).toBe('unknown');
    await sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('reports reconnect on explicit scope rejection and invalidates the prior send revision', async () => {
    mocks.send.mockRejectedValue(new ProviderHttpError(403));
    await expect(
      sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
    ).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
    expect(draft.status).toBe('editing');
    expect(draft.revision).toBe(3);
    await expect(
      sendReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('updates local archive only after provider success and leaves handled unchanged', async () => {
    mocks.action.mockRejectedValueOnce(new ProviderActionUnknown());
    await expect(changeMailboxMessage('owner', 'WORK', 'email', 'archive')).rejects.toMatchObject({
      code: 'ACTION_UNCONFIRMED',
    });
    expect(mocks.emailUpdate).not.toHaveBeenCalled();
    mocks.action.mockResolvedValue(undefined);
    await changeMailboxMessage('owner', 'WORK', 'email', 'archive');
    expect(mocks.emailUpdate).toHaveBeenCalledWith({
      where: { id: 'email', userId: 'owner', workspace: 'WORK', accountId: 'account' },
      data: { inInbox: false },
    });
  });
});
