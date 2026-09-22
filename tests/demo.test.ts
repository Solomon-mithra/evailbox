import { beforeEach, it, expect } from 'vitest';
import { readDemo, mutateDemo, filterWorkspace } from '../src/lib/demo';
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    configurable: true,
  });
});
it('combines subject, tag, account and date filters', () => {
  const result = filterWorkspace(readDemo(), {
    search: 'role',
    tag: 'opportunities',
    account: 'outlook',
    range: 'week',
  });
  expect(result.total).toBe(1);
  expect(result.emails[0].senderName).toBe('Maya Chen');
});
it('handled state removes a message from priority without deleting it', () => {
  mutateDemo('/api/emails/demo-0', 'PATCH', { handled: true });
  const w = filterWorkspace(readDemo(), {});
  expect(w.needsTotal).toBe(2);
  expect(w.emails).toHaveLength(9);
  expect(w.emails.find((e) => e.id === 'demo-0')?.handled).toBe(true);
});
it('supports tag create, edit, classifier and delete lifecycle', () => {
  mutateDemo('/api/tags', 'POST', {
    name: 'Coffee',
    description: 'Catch up',
    prompt: 'Messages inviting me for coffee',
    priority: 'LOW',
    keywords: ['coffee'],
    senders: [],
  });
  const tag = readDemo().tags.find((t) => t.name === 'Coffee')!;
  mutateDemo('/api/classify/batch', 'POST', { tagId: tag.id });
  expect(filterWorkspace(readDemo(), { tag: tag.id }).total).toBe(1);
  mutateDemo('/api/tags/' + tag.id, 'PATCH', {
    name: 'Meetups',
    prompt: 'Coffee and casual catch-ups',
  });
  expect(filterWorkspace(readDemo(), { tag: tag.id }).total).toBe(0);
  mutateDemo('/api/tags/' + tag.id, 'DELETE', {});
  expect(readDemo().tags.find((t) => t.id === tag.id)).toBeUndefined();
});
it('persists notification preferences across reads', () => {
  mutateDemo('/api/settings', 'PATCH', { dailyDigest: true, digestTime: '11:15' });
  expect(readDemo().preferences).toMatchObject({ dailyDigest: true, digestTime: '11:15' });
});
it('disconnecting one account removes only its cached mail', () => {
  mutateDemo('/api/accounts/gmail', 'DELETE', {});
  expect(readDemo().accounts.map((a) => a.id)).toEqual(['outlook']);
  expect(readDemo().emails.every((e) => e.accountId === 'outlook')).toBe(true);
});

it('keeps existing Personal data and starts Work empty', () => {
  const personal = readDemo('PERSONAL');
  const work = readDemo('WORK');
  expect(personal.emails).toHaveLength(9);
  expect(work.accounts).toEqual([]);
  expect(work.tags).toEqual([]);
  expect(work.emails).toEqual([]);
});
it('persists tags independently in each workspace', () => {
  mutateDemo(
    '/api/tags',
    'POST',
    {
      name: 'Clients',
      description: '',
      prompt: 'Messages from my clients',
      priority: 'HIGH',
      keywords: ['client'],
      senders: [],
    },
    'WORK',
  );
  expect(readDemo('WORK').tags.map((t) => t.name)).toEqual(['Clients']);
  expect(readDemo('PERSONAL').tags.some((t) => t.name === 'Clients')).toBe(false);
});
it('cannot alter Personal messages from Work', () => {
  mutateDemo('/api/emails/demo-0', 'PATCH', { handled: true }, 'WORK');
  expect(readDemo('PERSONAL').emails[0].handled).toBe(false);
});
