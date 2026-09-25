import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  send: vi.fn(),
  reconcile: vi.fn(),
  action: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.user }));
vi.mock('@/lib/mail-actions', () => ({
  getReplyDraft: mocks.get,
  saveReplyDraft: mocks.save,
  sendReplyDraft: mocks.send,
  reconcileReplyDraft: mocks.reconcile,
  changeMailboxMessage: mocks.action,
}));
import { GET, PATCH } from '../src/app/api/emails/[id]/draft/route';
import { POST as reply } from '../src/app/api/emails/[id]/reply/route';
import { POST as action } from '../src/app/api/emails/[id]/actions/route';
const context = { params: Promise.resolve({ id: 'email' }) };
const request = (
  path: string,
  method: string,
  body?: unknown,
  origin = 'https://app.example.com',
) =>
  new Request(`https://app.example.com/api/emails/email/${path}?workspace=WORK`, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  mocks.user.mockResolvedValue({ id: 'owner' });
  mocks.get.mockResolvedValue({ draft: null });
  mocks.save.mockResolvedValue({ id: 'draft' });
  mocks.send.mockResolvedValue({ status: 'accepted' });
  mocks.reconcile.mockResolvedValue({ status: 'unknown' });
  mocks.action.mockResolvedValue({ confirmed: true });
});
describe('authenticated explicit mail actions', () => {
  it('requires same-origin for draft saves and send before authorizing a user', async () => {
    expect(
      (await PATCH(request('draft', 'PATCH', {}, 'https://evil.example'), context)).status,
    ).toBe(403);
    expect(
      (await reply(request('reply', 'POST', {}, 'https://evil.example'), context)).status,
    ).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('passes authenticated owner, validated workspace and dynamic email id to read/save', async () => {
    await GET(request('draft', 'GET'), context);
    await PATCH(
      request('draft', 'PATCH', { body: 'hello', mode: 'reply', revision: null }),
      context,
    );
    expect(mocks.get).toHaveBeenCalledWith('owner', 'WORK', 'email', undefined);
    expect(mocks.save).toHaveBeenCalledWith('owner', 'WORK', 'email', {
      body: 'hello',
      mode: 'reply',
      revision: null,
    });
  });
  it('separates explicit send from reconciliation and rejects arbitrary recipients', async () => {
    await reply(
      request('reply', 'POST', { intent: 'send', draftId: 'draft', revision: 2 }),
      context,
    );
    expect(mocks.send).toHaveBeenCalledWith('owner', 'WORK', 'email', {
      draftId: 'draft',
      revision: 2,
    });
    await reply(request('reply', 'POST', { intent: 'reconcile' }), context);
    expect(mocks.reconcile).toHaveBeenCalledWith('owner', 'WORK', 'email');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(
      (
        await reply(
          request('reply', 'POST', {
            intent: 'send',
            draftId: 'draft',
            revision: 2,
            to: ['evil@example.com'],
          }),
          context,
        )
      ).status,
    ).toBe(400);
  });
  it('validates mailbox actions and workspace before mutation', async () => {
    expect((await action(request('actions', 'POST', { action: 'delete' }), context)).status).toBe(
      400,
    );
    await action(request('actions', 'POST', { action: 'archive' }), context);
    expect(mocks.action).toHaveBeenCalledWith('owner', 'WORK', 'email', 'archive');
  });
});
