import { describe, expect, it, vi } from 'vitest';
import {
  getDemoReplyDraft,
  saveDemoReplyDraft,
  sendDemoReplyDraft,
  listDemoReplyDrafts,
} from '../src/lib/reply-demo';
const email = {
  id: 'demo-email',
  accountId: 'a',
  subject: 'Subject',
  sender: 'sender@example.com',
};
describe('demo replies never send email', () => {
  it('saves and reopens only in memory and separates workspaces', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const saved = saveDemoReplyDraft('WORK', email, 'me@example.com', {
      body: 'Sample reply',
      mode: 'reply-all',
    });
    expect(getDemoReplyDraft('WORK', email, 'me@example.com').draft?.body).toBe('Sample reply');
    expect(getDemoReplyDraft('PERSONAL', email, 'me@example.com').draft).toBeNull();
    expect(sendDemoReplyDraft('WORK', email.id).status).toBe('accepted');
    expect(listDemoReplyDrafts('WORK')).toEqual([
      expect.objectContaining({ id: saved.id, emailId: email.id }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

it('demo read and archive act on the selected message without changing handled or calling a provider', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { readDemo, mutateDemo } = await import('../src/lib/demo');
  const original = readDemo().emails[0];
  mutateDemo(`/api/emails/${original.id}/actions`, 'POST', { action: 'read' });
  expect(readDemo().emails.find((e) => e.id === original.id)).toMatchObject({
    isRead: true,
    handled: original.handled,
  });
  mutateDemo(`/api/emails/${original.id}/actions`, 'POST', { action: 'unread' });
  expect(readDemo().emails.find((e) => e.id === original.id)?.isRead).toBe(false);
  mutateDemo(`/api/emails/${original.id}/actions`, 'POST', { action: 'archive' });
  expect(readDemo().emails.some((e) => e.id === original.id)).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('shows the correct provider on an Outlook demo reply and its saved draft summary', () => {
  const message = { ...email, id: 'outlook-demo', accountId: 'outlook' };
  saveDemoReplyDraft(
    'PERSONAL',
    message,
    'me@outlook.example',
    { body: 'reply', mode: 'reply' },
    'OUTLOOK',
  );
  expect(
    getDemoReplyDraft('PERSONAL', message, 'me@outlook.example', 'reply', 'OUTLOOK').account
      .provider,
  ).toBe('OUTLOOK');
  expect(
    listDemoReplyDrafts('PERSONAL').find((d) => d.emailId === 'outlook-demo')?.account.provider,
  ).toBe('OUTLOOK');
});
