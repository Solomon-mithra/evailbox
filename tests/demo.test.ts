import { beforeEach, it, expect } from 'vitest';
import { readDemo, mutateDemo, filterWorkspace, seedDemo } from '../src/lib/demo';
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

it.each(['PERSONAL', 'WORK'] as const)(
  'preserves %s data when migrating the previous brand storage',
  (workspace) => {
    const oldKey = workspace === 'PERSONAL' ? 'jevinbox-demo-v1' : 'jevinbox-demo-v1-work';
    const newKey = workspace === 'PERSONAL' ? 'evailbox-demo-v1' : 'evailbox-demo-v1-work';
    const saved = seedDemo();
    saved.emails[0].handled = true;
    saved.tags[0].name = 'My custom tag';
    store.set(oldKey, JSON.stringify(saved));
    const restored = readDemo(workspace);
    expect(restored.emails[0].handled).toBe(true);
    expect(restored.tags[0].name).toBe('My custom tag');
    expect(store.has(newKey)).toBe(true);
    expect(store.has(oldKey)).toBe(false);
  },
);

it('reset removes both old and new demo workspaces without restoring deleted data', () => {
  const saved = seedDemo();
  saved.tags[0].name = 'Should be cleared';
  for (const key of [
    'jevinbox-demo-v1',
    'jevinbox-demo-v1-work',
    'evailbox-demo-v1',
    'evailbox-demo-v1-work',
  ]) {
    store.set(key, JSON.stringify(saved));
  }
  mutateDemo('/api/user', 'DELETE', {});
  expect(store.size).toBe(0);
  expect(readDemo('PERSONAL').tags[0].name).toBe('Immigration');
  expect(readDemo('WORK').tags).toEqual([]);
});

it('reads saved demo changes even when migrating storage cannot write', () => {
  const saved = seedDemo();
  saved.emails[0].handled = true;
  saved.emails[0].body = 'This is a sample email in the JevInbox demo workspace.';
  store.set('jevinbox-demo-v1', JSON.stringify(saved));
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => {
        throw new Error('Storage quota');
      },
      removeItem: (key: string) => store.delete(key),
    },
    configurable: true,
  });
  const restored = readDemo();
  expect(restored.emails[0].handled).toBe(true);
  expect(restored.emails[0].body).toContain('evailbox demo workspace');
  expect(store.has('jevinbox-demo-v1')).toBe(true);
});

it('prefers current data over an old brand backup', () => {
  const old = seedDemo();
  const current = seedDemo();
  current.emails[0].handled = true;
  store.set('jevinbox-demo-v1', JSON.stringify(old));
  store.set('evailbox-demo-v1', JSON.stringify(current));
  expect(readDemo().emails[0].handled).toBe(true);
});

it('renames generated sample copy without changing user-authored rules', () => {
  const saved = seedDemo();
  const prompt = 'Find emails mentioning a live Jev call or the JevInbox demo workspace.';
  saved.tags[0].prompt = prompt;
  saved.tags[0].keywords = ['live Jev call'];
  saved.tags[0].name = 'JevInbox demo workspace';
  saved.emails[0].body = 'This is a sample email in the JevInbox demo workspace.';
  store.set('jevinbox-demo-v1', JSON.stringify(saved));
  const restored = readDemo();
  expect(restored.tags[0].prompt).toBe(prompt);
  expect(restored.tags[0].keywords).toEqual(['live Jev call']);
  expect(restored.tags[0].name).toBe('JevInbox demo workspace');
  expect(restored.emails[0].body).toContain('evailbox demo workspace');
});
