import { beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/hooks/useFetch', () => ({
  useInboxWorkspace: mocks.query,
  useAction: () => ({ isPending: false }),
}));
vi.mock('@/components/providers', () => ({ useDemo: () => false }));
vi.mock('@/components/workspace-selection', () => ({
  useWorkspaceSelection: () => ({ workspace: 'PERSONAL', select: () => {} }),
}));
vi.mock('@/components/email-detail', () => ({ EmailDetail: () => null }));
vi.mock('@/hooks/useEmailPreload', () => ({
  useEmailPreload: () => ({ start: () => {}, cancel: () => {}, open: () => {} }),
}));
import { InboxView } from '@/components/inbox';
// Vitest's JSX preserve transform needs the runtime global for these Next components.
vi.stubGlobal('React', React);
beforeEach(() =>
  mocks.query.mockReturnValue({
    data: {
      user: { id: 'alice', email: 'a@example.com' },
      emails: [
        {
          id: 'mail',
          subject: 'Usable summary',
          sender: 'a@example.com',
          senderName: 'A',
          snippet: 'Body-free cached mail',
          receivedAt: new Date().toISOString(),
          handled: false,
          isRead: false,
          classifications: [],
        },
      ],
      tags: [],
      accounts: [],
      total: 1,
      page: 0,
      pageSize: 50,
    },
    metadataReady: false,
    countsReady: false,
    metadataError: new Error('unavailable'),
    countsError: new Error('unavailable'),
    isLoading: false,
    isError: false,
  }),
);
it('renders usable summaries when independent metadata and counts fail', () => {
  const html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('Usable summary');
  expect(html).toContain('Some inbox details are unavailable');
  expect(html).not.toContain('One inbox starts here');
});
it('shows the next cursor action without waiting for a total count', () => {
  mocks.query.mockReturnValue({ ...mocks.query(), nextCursor: 'opaque-next' });
  const html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('Next');
  expect(html).toContain('Page 1');
});
it('keeps restored summaries visible if background refresh fails', () => {
  mocks.query.mockReturnValue({ ...mocks.query(), isError: true, error: new Error('Offline') });
  expect(renderToStaticMarkup(React.createElement(InboxView))).toContain('Usable summary');
});
it('shows the account row only during its initial import', () => {
  const query = mocks.query();
  const account = {
    id: 'a',
    email: 'personal@example.com',
    imported: 40,
    tagged: 0,
    remaining: 40,
    importing: true,
    initialSync: true,
    syncing: true,
  };
  const processing = {
    imported: 40,
    tagged: 0,
    remaining: 40,
    importing: true,
    paused: false,
    accounts: [account],
  };
  mocks.query.mockReturnValue({ ...query, data: { ...query.data, processing } });
  let html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('40 emails');
  expect(html).toContain('personal@example.com');
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="40"');
  expect(html).toContain('Syncing…');
  expect(html).not.toMatch(/Tagging|paused|retrying|Updating…/);

  // Import finished; all messages still await AI and the durable queue stays pending.
  mocks.query.mockReturnValue({
    ...query,
    data: {
      ...query.data,
      user: { ...query.data.user, workRequested: true },
      accounts: [{ id: 'a', email: account.email, lastSync: new Date().toISOString() }],
      processing: {
        ...processing,
        imported: 100,
        remaining: 100,
        importing: false,
        paused: true,
        accounts: [
          {
            ...account,
            imported: 100,
            remaining: 100,
            importing: false,
            initialSync: false,
            syncing: false,
          },
        ],
      },
    },
  });
  html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).not.toContain('role="progressbar"');
  expect(html).not.toContain('inbox-progress-account');
  expect(html).not.toContain('Updating…');
  expect(html).not.toContain('Syncing…');
  expect(html).toContain('Synced');
  expect(html).toContain('Usable summary');
});

it('never brings back onboarding progress for routine syncs or retagging', () => {
  const query = mocks.query();
  for (const syncing of [false, true]) {
    mocks.query.mockReturnValue({
      ...query,
      data: {
        ...query.data,
        user: { ...query.data.user, workRequested: true },
        processing: {
          imported: 101,
          tagged: 0,
          remaining: 101,
          importing: true,
          paused: false,
          accounts: [
            {
              id: 'a',
              email: 'personal@example.com',
              imported: 101,
              tagged: 0,
              remaining: 101,
              importing: true,
              initialSync: false,
              syncing,
            },
          ],
        },
      },
    });
    const html = renderToStaticMarkup(React.createElement(InboxView));
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('personal@example.com');
    expect(html).not.toContain('Updating…');
    expect(html.includes('Syncing…')).toBe(syncing);
  }
});

it('shows only the newly connecting account when another mailbox is established', () => {
  const query = mocks.query();
  mocks.query.mockReturnValue({
    ...query,
    data: {
      ...query.data,
      processing: {
        imported: 107,
        tagged: 0,
        remaining: 107,
        importing: true,
        paused: false,
        accounts: [
          {
            id: 'a',
            email: 'established@example.com',
            imported: 100,
            tagged: 0,
            remaining: 100,
            importing: true,
            initialSync: false,
            syncing: false,
          },
          {
            id: 'b',
            email: 'new@example.com',
            imported: 7,
            tagged: 0,
            remaining: 7,
            importing: true,
            initialSync: true,
            syncing: false,
          },
        ],
      },
    },
  });
  const html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('7 emails');
  expect(html).toContain('new@example.com');
  expect(html).not.toContain('established@example.com');
  expect(html).not.toContain('Syncing…');
});

it('keeps an actionable billing link without showing finished initial progress', () => {
  const query = mocks.query();
  mocks.query.mockReturnValue({
    ...query,
    data: {
      ...query.data,
      processing: {
        imported: 100,
        tagged: 0,
        remaining: 100,
        importing: false,
        paused: true,
        billingBlocked: true,
        accounts: [
          {
            id: 'a',
            email: 'personal@example.com',
            imported: 100,
            tagged: 0,
            remaining: 100,
            importing: false,
            initialSync: false,
            syncing: false,
          },
        ],
      },
    },
  });
  const html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('Manage plan');
  expect(html).not.toContain('role="progressbar"');
  expect(html).not.toContain('personal@example.com');
});
