import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  db: {
    notificationPref: { findMany: vi.fn(), findUnique: vi.fn() },
    digestHistory: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    emailClassification: { findMany: vi.fn(), updateMany: vi.fn() },
    pushSubscription: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
  due: vi.fn(),
  send: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../src/lib/db', () => ({ db: fixture.db }));
vi.mock('../src/lib/notification-utils', async () => ({
  ...(await vi.importActual<typeof import('../src/lib/notification-utils')>(
    '../src/lib/notification-utils',
  )),
  digestWindow: fixture.due,
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: fixture.send },
}));
import { sendDigests } from '../src/lib/digest';
import { notifyUser } from '../src/lib/notifications';
it.each(['', 'replace-with-resend-key', 'key••••'])(
  'rejects unconfigured digest delivery before touching jobs (%s)',
  async (key) => {
    vi.stubEnv('RESEND_API_KEY', key);
    await expect(sendDigests()).rejects.toMatchObject({
      status: 503,
      code: 'DIGEST_NOT_CONFIGURED',
    });
    expect(fixture.db.notificationPref.findMany).not.toHaveBeenCalled();
    expect(fetchFixture).not.toHaveBeenCalled();
  },
);
const now = new Date('2026-09-21T09:00:00Z');
const pref = {
  userId: 'u1',
  dailyDigest: true,
  timezone: 'UTC',
  digestTime: '09:00',
  minConfidence: 80,
  unsubscribeToken: 'token',
  user: { email: 'me@example.com' },
};
const history = {
  id: 'digest1',
  userId: 'u1',
  localDate: '2026-09-21',
  status: 'pending',
  leaseUntil: new Date(now.getTime() - 1),
  windowEnd: now,
  payload: null,
  sentAt: null,
};
const match = (i: number) => ({
  id: `c${i}`,
  createdAt: new Date('2026-09-21T08:30:00Z'),
  tagVersion: 1,
  tag: { version: 1, name: 'Work' },
  email: { id: `e${i}`, subject: `Subject-${i}`, senderName: 'Ada', sender: 'ada@example.com' },
});
let fetchFixture: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
  vi.stubEnv('DIGEST_FROM', 'App <digest@example.com>');
  vi.stubEnv('RESEND_API_KEY', 'fixture');
  vi.stubEnv('VAPID_SUBJECT', 'mailto:admin@example.com');
  vi.stubEnv('VAPID_PUBLIC_KEY', 'public');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private');
  fixture.due.mockReturnValue({ due: true, date: '2026-09-21' });
  fixture.db.notificationPref.findMany.mockResolvedValue([pref]);
  fixture.db.digestHistory.findUnique.mockResolvedValue(null);
  fixture.db.digestHistory.findFirst.mockImplementation(async ({ where }) =>
    where.status === 'sent' ? null : history,
  );
  fixture.db.digestHistory.create.mockResolvedValue({
    ...history,
    leaseUntil: new Date(now.getTime() + 120000),
  });
  fixture.db.digestHistory.update.mockImplementation(async ({ data }) => ({ ...history, ...data }));
  fixture.db.digestHistory.updateMany.mockResolvedValue({ count: 1 });
  fixture.db.emailClassification.findMany.mockResolvedValue([]);
  fetchFixture = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: 'resend-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchFixture);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('digest snapshot and retries', () => {
  it('uses snapshot cutoff and paginates beyond 200 matches without dropping mail', async () => {
    const previous = {
      ...history,
      id: 'previous',
      status: 'sent',
      windowEnd: new Date('2026-09-20T09:00:00Z'),
    };
    fixture.db.digestHistory.findFirst.mockImplementation(async ({ where }) =>
      where.status === 'sent' ? previous : history,
    );
    fixture.db.emailClassification.findMany
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => match(i)))
      .mockResolvedValueOnce([match(200)]);
    await sendDigests();
    const body = JSON.parse(fetchFixture.mock.calls[0][1].body);
    expect(body.html).toContain('Subject-200');
    expect(body.html).toContain('https://app.example/inbox?workspace=PERSONAL&amp;email=e0');
    expect(body.html).toContain('201 Personal · Work');
    expect(fixture.db.emailClassification.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: previous.windowEnd,
      lt: history.windowEnd,
    });
    expect(fixture.db.emailClassification.findMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'c199' },
      skip: 1,
    });
    const snapshot = fixture.db.digestHistory.updateMany.mock.calls.find(
      ([args]) => args.data.payload,
    );
    expect(snapshot?.[0].data.payload).toEqual(body);
  });
  it('retries the immutable payload outside the due window with the same idempotency key', async () => {
    const payload = {
      from: 'Original sender',
      to: ['original@example.com'],
      subject: 'Original',
      html: 'Frozen content',
      headers: { 'List-Unsubscribe': '<https://app.example/unsubscribe?token=x>' },
    };
    fixture.due.mockReturnValue({ due: false, date: '2026-09-21' });
    fixture.db.digestHistory.findFirst.mockResolvedValue({ ...history, status: 'failed', payload });
    await sendDigests();
    expect(fixture.db.emailClassification.findMany).not.toHaveBeenCalled();
    expect(fetchFixture).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchFixture.mock.calls[0][1].body)).toEqual(payload);
    expect(fetchFixture.mock.calls[0][1].headers['Idempotency-Key']).toBe('digest-digest1');
  });
  it('does not send a partially assembled digest when the deadline expires', async () => {
    fixture.db.emailClassification.findMany.mockImplementation(async () => {
      vi.setSystemTime(new Date(now.getTime() + 2000));
      return Array.from({ length: 200 }, (_, i) => match(i));
    });
    const result = await sendDigests(now.getTime() + 1000);
    expect(fetchFixture).not.toHaveBeenCalled();
    expect(result.pending).toBeGreaterThan(0);
    expect(
      fixture.db.digestHistory.updateMany.mock.calls.some(
        ([args]) => args.data.leaseUntil?.getTime() <= Date.now(),
      ),
    ).toBe(true);
  });
});
describe('push deadline', () => {
  const subscription = {
    id: 'sub',
    endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    p256dh: 'key',
    auth: 'auth',
  };
  beforeEach(() => {
    fixture.db.notificationPref.findUnique.mockResolvedValue({
      browserPush: true,
      minConfidence: 80,
    });
    fixture.db.pushSubscription.findMany.mockResolvedValue([
      subscription,
      { ...subscription, id: 'sub2' },
    ]);
    fixture.db.emailClassification.findMany.mockResolvedValue([
      { ...match(1), id: 'c1', emailId: 'e1' },
    ]);
    fixture.db.emailClassification.updateMany.mockResolvedValue({ count: 1 });
  });
  it('links push notifications to the inbox with their workspace and encoded email ID', async () => {
    fixture.db.emailClassification.findMany.mockResolvedValue([
      { ...match(1), emailId: 'email/1', workspace: 'WORK' },
    ]);
    fixture.send.mockResolvedValue({});
    await notifyUser('u1');
    expect(JSON.parse(fixture.send.mock.calls[0][1]).url).toBe(
      '/inbox?workspace=WORK&email=email%2F1',
    );
  });
  it('never claims a notification after the shared deadline', async () => {
    await notifyUser('u1', Date.now() - 1);
    expect(fixture.db.emailClassification.updateMany).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });
  it('clears an undelivered claim and stops before the next device when time expires', async () => {
    fixture.send.mockImplementation(async () => {
      vi.setSystemTime(new Date(now.getTime() + 2000));
      throw new Error('timeout');
    });
    await notifyUser('u1', now.getTime() + 1000);
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.send.mock.calls[0][2].timeout).toBeLessThanOrEqual(1000);
    expect(fixture.db.emailClassification.updateMany.mock.calls.at(-1)?.[0].data).toEqual({
      notifiedAt: null,
    });
  });
});
