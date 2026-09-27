import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  fetch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { email: { findFirst: mocks.find }, emailAccount: { updateMany: mocks.update } },
}));
vi.mock('@/lib/crypto', () => ({
  decrypt: (v: string) => v.replace('encrypted:', ''),
  encrypt: (v: string) => `encrypted:${v}`,
}));
vi.mock('@/lib/providers', () => ({ refreshAccessToken: mocks.refresh }));
vi.mock('@/lib/providers/thread', () => ({ fetchMessageThread: mocks.fetch }));
import { getEmailThread } from '../src/lib/email-thread';
const account = {
  id: 'account',
  provider: 'GMAIL',
  accessToken: 'encrypted:old',
  refreshToken: 'encrypted:refresh',
  expiresAt: new Date(Date.now() + 3600000),
};
const thread = {
  partial: false,
  messages: [
    {
      id: 'selected',
      sender: 'sender@example.com',
      senderName: 'Sender',
      receivedAt: '2026-09-26T12:00:00.000Z',
      content: {
        format: 'html',
        content:
          '<p>Full reply</p><script>malicious()</script><img src="https://tracking.example/pixel">',
      },
      current: true,
      fallback: false,
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue({
    account,
    providerMessageId: 'selected',
    snippet: 'Saved preview',
  });
  mocks.fetch.mockResolvedValue(thread);
});
describe('conversation authorization and credentials', () => {
  it('requires matching email and account ownership and workspace before contacting the provider', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(getEmailThread('owner', 'WORK', 'foreign-email', false)).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.find).toHaveBeenCalledWith({
      where: {
        id: 'foreign-email',
        userId: 'owner',
        workspace: 'WORK',
        account: { userId: 'owner', workspace: 'WORK' },
      },
      include: { account: true },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('sanitizes each reply in an isolated document without writing bodies or exposing credentials', async () => {
    const result = await getEmailThread('owner', 'PERSONAL', 'email', false);
    expect(result.partial).toBe(false);
    expect(result.messages[0]).toMatchObject({ id: 'selected', current: true, fallback: false });
    expect(result.messages[0].html).toContain('Full reply');
    expect(result.messages[0].html).not.toContain('malicious()');
    expect(result.messages[0].html).not.toContain('https://tracking.example');
    expect(result.messages[0]).not.toHaveProperty('content');
    expect(JSON.stringify(result)).not.toContain('encrypted:');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith('GMAIL', 'old', 'selected');
  });
  it('passes explicit image loading through to reply documents', async () => {
    const result = await getEmailThread('owner', 'PERSONAL', 'email', true);
    expect(result.messages[0].html).toContain('https://tracking.example/pixel');
  });
  it('refreshes credentials conditionally without acquiring the mailbox mutation lock', async () => {
    mocks.find.mockResolvedValue({
      account: { ...account, expiresAt: new Date(0) },
      providerMessageId: 'selected',
    });
    mocks.refresh.mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'rotated',
      expiresAt: Date.now() + 3600000,
    });
    await getEmailThread('owner', 'WORK', 'email', false);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'account', userId: 'owner', workspace: 'WORK', accessToken: 'encrypted:old' },
      data: {
        accessToken: 'encrypted:new',
        refreshToken: 'encrypted:rotated',
        expiresAt: expect.any(Date),
      },
    });
    expect(mocks.fetch).toHaveBeenCalledWith('GMAIL', 'new', 'selected');
  });
  it('reports a retriable thread error when the provider fails without claiming preview is the thread', async () => {
    mocks.fetch.mockRejectedValue(new Error('secret token and provider detail'));
    await expect(getEmailThread('owner', 'PERSONAL', 'email', false)).rejects.toMatchObject({
      status: 502,
      code: 'THREAD_UNAVAILABLE',
    });
    await expect(getEmailThread('owner', 'PERSONAL', 'email', false)).rejects.not.toThrow('secret');
  });
});
