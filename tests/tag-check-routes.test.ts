import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  tag: vi.fn(),
  emailCount: vi.fn(),
  transaction: vi.fn(),
  capture: vi.fn(),
  execute: vi.fn(),
  userUpdate: vi.fn(),
  lock: vi.fn(),
  after: vi.fn(),
  publish: vi.fn(),
  tagUpdate: vi.fn(),
  deleteDecisions: vi.fn(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: m.after,
}));
vi.mock('@/lib/auth', () => ({ requireUser: m.auth }));
vi.mock('@/lib/db', () => ({
  db: {
    tag: { findFirst: m.tag },
    email: { count: m.emailCount },
    $transaction: m.transaction,
  },
}));
vi.mock('@/lib/billing/state', () => ({ lockBillingUser: m.lock }));
vi.mock('@/lib/tag-scope', async (original) => ({
  ...(await original<typeof import('@/lib/tag-scope')>()),
  capturePendingTagHistory: m.capture,
}));
vi.mock('@/lib/inngest/dispatch', () => ({ publishUserWork: m.publish }));
vi.mock('@/lib/inngest/client', () => ({ backgroundConfigured: () => true }));
import { POST, PATCH } from '@/app/api/[...path]/route';
const tx = {
  $executeRaw: m.execute,
  user: { update: m.userUpdate },
  tag: { findUniqueOrThrow: m.tag, update: m.tagUpdate },
  emailClassification: { deleteMany: m.deleteDecisions },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('APP_MODE', 'live');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  m.auth.mockResolvedValue({ id: 'u' });
  m.tag.mockResolvedValue({
    id: 't',
    name: 'Tag',
    prompt: 'Tag matching rule',
    keywords: [],
    senders: [],
  });
  m.tagUpdate.mockResolvedValue({ id: 't' });
  m.transaction.mockImplementation((run) => run(tx));
});
afterEach(() => vi.unstubAllEnvs());
function request(body: Record<string, unknown> = {}) {
  return new Request('http://localhost:3000/api/classify/batch?workspace=WORK', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it.each([undefined, 't'])(
  'queues one pending snapshot for the requested workspace/tag %s',
  async (tagId) => {
    const response = await POST(request(tagId ? { tagId } : {}));
    expect(response.status).toBe(202);
    expect(m.capture).toHaveBeenCalledWith(tx, 'u', 'WORK', tagId);
    expect(m.userUpdate).toHaveBeenCalledWith({
      where: { id: 'u' },
      data: { workRequested: true, workRevision: { increment: 1 } },
    });
    expect(m.publish).not.toHaveBeenCalled();
    await m.after.mock.calls[0][0]();
    expect(m.publish).toHaveBeenCalledWith('u');
  },
);
it('rejects a foreign or missing tag before changing history or queueing work', async () => {
  m.tag.mockResolvedValue(null);
  expect((await POST(request({ tagId: 'foreign' }))).status).toBe(404);
  expect(m.tag).toHaveBeenCalledWith({ where: { id: 'foreign', userId: 'u', workspace: 'WORK' } });
  expect(m.transaction).not.toHaveBeenCalled();
  expect(m.after).not.toHaveBeenCalled();
});
it('does not dispatch if the durable scope cannot be saved', async () => {
  m.capture.mockRejectedValue(new Error('Could not save scope'));
  expect((await POST(request())).status).toBe(500);
  expect(m.userUpdate).not.toHaveBeenCalled();
  expect(m.after).not.toHaveBeenCalled();
});
it.each([false, true])(
  'preserves metadata-only edits and invalidates changed matching rules: %s',
  async (changeRule) => {
    const response = await PATCH(
      new Request('http://localhost:3000/api/tags/t?workspace=WORK', {
        method: 'PATCH',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Tag',
          prompt: changeRule ? 'A different matching rule' : 'Tag matching rule',
          keywords: [],
          senders: [],
          priority: 'HIGH',
          description: 'Updated description',
        }),
      }),
    );
    expect(response.status).toBe(200);
    if (changeRule) {
      expect(m.tagUpdate.mock.calls[0][0].data.version).toEqual({ increment: 1 });
      expect(m.deleteDecisions).toHaveBeenCalledOnce();
    } else {
      expect(m.tagUpdate.mock.calls[0][0].data).not.toHaveProperty('version');
      expect(m.deleteDecisions).not.toHaveBeenCalled();
      expect(m.userUpdate).not.toHaveBeenCalled();
    }
  },
);
