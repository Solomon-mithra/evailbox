import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  draftFind: vi.fn(),
  draftCreate: vi.fn(),
  draftList: vi.fn(),
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
      findMany: mocks.draftList,
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
  getReplyContext,
  beginReplyDraft,
  listReplyDrafts,
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
  mocks.draftFind.mockImplementation(async ({ where }) =>
    Object.entries(where).every(([key, value]) => draft[key] === value) ? { ...draft } : null,
  );
  mocks.draftList.mockResolvedValue([]);
  mocks.draftUpdate.mockImplementation(async ({ where, data }) => {
    if (
      ['id', 'userId', 'workspace', 'emailId', 'accountId'].some(
        (key) => where[key] !== undefined && draft[key] !== where[key],
      )
    )
      return { count: 0 };
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
  it('returns saved draft and account immediately without requesting provider context', async () => {
    const result = await getReplyDraft('owner', 'WORK', 'email', undefined, false);
    expect(result).toMatchObject({
      draft: { id: 'draft', body: 'My reply' },
      account,
      context: null,
      notice: null,
    });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('loads provider recipient context separately without reading a possibly stale draft', async () => {
    const result = await getReplyContext('owner', 'WORK', 'email', 'reply-all');
    expect(result).toEqual({ context: reply, notice: null });
    expect(mocks.context).toHaveBeenCalledWith(
      'GMAIL',
      'token',
      'original',
      'me@example.com',
      'reply-all',
    );
    expect(mocks.draftFind).not.toHaveBeenCalled();
  });
  it('excludes accepted replies from the scoped Drafts list', async () => {
    await listReplyDrafts('owner', 'WORK');
    expect(mocks.draftList).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          workspace: 'WORK',
          account: { userId: 'owner', workspace: 'WORK' },
          email: { userId: 'owner', workspace: 'WORK' },
          status: { not: 'accepted' },
        },
      }),
    );
  });
  it('atomically starts another reply after acceptance with fresh identity and a monotonic revision', async () => {
    Object.assign(draft, {
      status: 'accepted',
      providerDraftId: 'old-provider-draft',
      providerMessageId: 'old-sent',
      acceptedAt: new Date(),
      lastError: 'old error',
    });
    const result = await beginReplyDraft('owner', 'WORK', 'email', {
      draftId: 'draft',
      revision: 2,
      mode: 'reply-all',
    });
    expect(result).toMatchObject({
      body: '',
      mode: 'reply-all',
      status: 'editing',
      revision: 3,
      acceptedAt: null,
      lastError: null,
    });
    expect(result.id).not.toBe('draft');
    expect(draft.rfcMessageId).not.toBe('<stable@evailbox.local>');
    expect(draft).toMatchObject({
      providerDraftId: null,
      providerMessageId: null,
      leaseId: null,
      leaseUntil: null,
    });
    expect(mocks.draftUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          workspace: 'WORK',
          emailId: 'email',
          accountId: 'account',
          id: 'draft',
          revision: 2,
          status: 'accepted',
        },
      }),
    );
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it('does not return a later edit as the result of beginning a blank reply', async () => {
    draft.status = 'accepted';
    const update = mocks.draftUpdate.getMockImplementation()!;
    mocks.draftUpdate.mockImplementationOnce(async (input) => {
      const result = await update(input);
      await saveReplyDraft('owner', 'WORK', 'email', {
        draftId: String(draft.id),
        revision: 3,
        body: 'Other tab already edited the reply',
        mode: 'reply',
      });
      return result;
    });
    await expect(
      beginReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(draft).toMatchObject({ revision: 4, body: 'Other tab already edited the reply' });
  });
  it('allows only one simultaneous begin request and rejects retries of the previous accepted identity', async () => {
    draft.status = 'accepted';
    const input = { draftId: 'draft', revision: 2 };
    const results = await Promise.allSettled([
      beginReplyDraft('owner', 'WORK', 'email', input),
      beginReplyDraft('owner', 'WORK', 'email', input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(draft.revision).toBe(3);
    await expect(sendReplyDraft('owner', 'WORK', 'email', input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(beginReplyDraft('owner', 'WORK', 'email', input)).rejects.toMatchObject({
      code: 'DRAFT_CONFLICT',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each(['editing', 'preparing', 'sending', 'unknown'])(
    'refuses to replace a %s draft',
    async (status) => {
      draft.status = status;
      await expect(
        beginReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
      ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
      expect(draft).toMatchObject({ id: 'draft', status, revision: 2, body: 'My reply' });
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
  it('rejects a mismatched accepted revision and foreign ownership before changing the draft', async () => {
    draft.status = 'accepted';
    await expect(
      beginReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 1 }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    mocks.email.mockResolvedValue(null);
    await expect(
      beginReplyDraft('foreign', 'WORK', 'email', { draftId: 'draft', revision: 2 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(draft).toMatchObject({ id: 'draft', revision: 2, status: 'accepted' });
  });
  it('matches draft identity as well as revision on updates, including after another reply begins', async () => {
    draft.status = 'accepted';
    const fresh = await beginReplyDraft('owner', 'WORK', 'email', {
      draftId: 'draft',
      revision: 2,
    });
    await expect(
      saveReplyDraft('owner', 'WORK', 'email', {
        body: 'stale old reply',
        mode: 'reply',
        revision: fresh.revision,
        draftId: 'draft',
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(
      saveReplyDraft('owner', 'WORK', 'email', {
        body: 'legacy stale old reply',
        mode: 'reply',
        revision: 2,
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    const saved = await saveReplyDraft('owner', 'WORK', 'email', {
      body: 'Second reply',
      mode: 'reply',
      revision: fresh.revision,
      draftId: fresh.id,
    });
    expect(saved).toMatchObject({ id: fresh.id, revision: 4, body: 'Second reply' });
    await sendReplyDraft('owner', 'WORK', 'email', { draftId: saved.id, revision: saved.revision });
    expect(mocks.prepare.mock.calls[0][5]).toBe('Second reply');
    expect(mocks.prepare.mock.calls[0][6]).not.toBe('<stable@evailbox.local>');
    expect(mocks.prepare.mock.calls[0][7]).toBeNull();
    expect(mocks.send).toHaveBeenCalledTimes(1);
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
  it('rejects stale reconciliation identity before reading the new reply from the provider', async () => {
    draft.status = 'accepted';
    const fresh = await beginReplyDraft('owner', 'WORK', 'email', {
      draftId: 'draft',
      revision: 2,
    });
    await expect(reconcileReplyDraft('owner', 'WORK', 'email', 'draft')).rejects.toMatchObject({
      status: 404,
    });
    expect(draft).toMatchObject({ id: fresh.id, status: 'editing', revision: 3 });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each([undefined, 'draft'])(
    'does not return a new reply when reconciliation for %s completes after rotation',
    async (identity) => {
      draft.status = 'unknown';
      mocks.reconcile
        .mockImplementationOnce(async () => {
          await reconcileReplyDraft('owner', 'WORK', 'email', 'draft');
          await beginReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 2 });
          return { status: 'accepted', providerMessageId: 'old-confirmed' };
        })
        .mockResolvedValue({ status: 'accepted', providerMessageId: 'old-confirmed' });
      await expect(reconcileReplyDraft('owner', 'WORK', 'email', identity)).rejects.toMatchObject({
        status: 404,
      });
      expect(draft.id).not.toBe('draft');
      expect(draft).toMatchObject({
        status: 'editing',
        revision: 3,
        body: '',
        providerMessageId: null,
      });
      expect(mocks.draftFind.mock.calls.at(-1)?.[0].where.id).toBe('draft');
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );
  it('rejects an older save response when another edit advances revision before the reread', async () => {
    const update = mocks.draftUpdate.getMockImplementation()!;
    mocks.draftUpdate.mockImplementationOnce(async (input) => {
      const result = await update(input);
      await saveReplyDraft('owner', 'WORK', 'email', {
        draftId: 'draft',
        revision: 3,
        body: 'Newer edit from another tab',
        mode: 'reply',
      });
      return result;
    });
    await expect(
      saveReplyDraft('owner', 'WORK', 'email', {
        draftId: 'draft',
        revision: 2,
        body: 'Older edit',
        mode: 'reply',
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(draft).toMatchObject({ id: 'draft', revision: 4, body: 'Newer edit from another tab' });
  });
  it('pins legacy save rereads to the edited identity if the reply is accepted and rotated concurrently', async () => {
    const update = mocks.draftUpdate.getMockImplementation()!;
    mocks.draftUpdate.mockImplementationOnce(async (input) => {
      const result = await update(input);
      draft.status = 'accepted';
      await beginReplyDraft('owner', 'WORK', 'email', { draftId: 'draft', revision: 3 });
      return result;
    });
    await expect(
      saveReplyDraft('owner', 'WORK', 'email', { body: 'Legacy save', mode: 'reply', revision: 2 }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(draft).toMatchObject({ status: 'editing', revision: 4, body: '' });
    expect(mocks.draftFind.mock.calls.at(-1)?.[0].where.id).toBe('draft');
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
