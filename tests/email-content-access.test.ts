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
vi.mock('@/lib/providers/content', () => ({ fetchMessageContent: mocks.fetch }));
import { emailContentResponse } from '../src/lib/email-content';

beforeEach(() => vi.resetAllMocks());
const account = {
  id: 'account',
  provider: 'GMAIL',
  accessToken: 'encrypted:old',
  refreshToken: 'encrypted:refresh',
  expiresAt: new Date(Date.now() + 3600000),
};
describe('message content authorization and recovery', () => {
  it('requires matching email and account ownership and workspace before any provider request', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(
      emailContentResponse('owner', 'WORK', 'foreign-email', false),
    ).rejects.toMatchObject({ status: 404 });
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
  it('returns full sanitized content without credentials or private caching', async () => {
    mocks.find.mockResolvedValue({ account, providerMessageId: 'provider-id', snippet: 'preview' });
    mocks.fetch.mockResolvedValue({ format: 'html', content: '<h1>Full newsletter</h1>' });
    const response = await emailContentResponse('owner', 'PERSONAL', 'email', false);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const body = await response.text();
    expect(body).toContain('Full newsletter');
    expect(body).not.toContain('encrypted:');
    expect(body).not.toContain('preview');
  });
  it('refreshes expired tokens and stores them encrypted using a conditional update', async () => {
    mocks.find.mockResolvedValue({
      account: { ...account, expiresAt: new Date(0) },
      providerMessageId: 'provider-id',
      snippet: 'preview',
    });
    mocks.refresh.mockResolvedValue({
      accessToken: 'new',
      refreshToken: 'rotated',
      expiresAt: Date.now() + 3600000,
    });
    mocks.fetch.mockResolvedValue({ format: 'text', content: 'Message' });
    await emailContentResponse('owner', 'PERSONAL', 'email', false);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'account', userId: 'owner', accessToken: 'encrypted:old' },
        data: expect.objectContaining({
          accessToken: 'encrypted:new',
          refreshToken: 'encrypted:rotated',
        }),
      }),
    );
    expect(mocks.fetch).toHaveBeenCalledWith('GMAIL', 'new', 'provider-id');
  });
  it('labels cached text when the provider fails, without exposing its error', async () => {
    mocks.find.mockResolvedValue({ account, providerMessageId: 'provider-id', body: 'Saved text' });
    mocks.fetch.mockRejectedValue(new Error('sensitive provider detail'));
    const body = await (await emailContentResponse('owner', 'PERSONAL', 'email', false)).text();
    expect(body).toContain('couldn’t load');
    expect(body).toContain('Saved text');
    expect(body).not.toContain('sensitive provider detail');
  });
});
