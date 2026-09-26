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
it('shows tagging progress while keeping unclassified summaries usable', () => {
  const query = mocks.query();
  mocks.query.mockReturnValue({
    ...query,
    data: {
      ...query.data,
      processing: { imported: 100, tagged: 34, remaining: 66, importing: false, paused: false },
    },
  });
  const html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('Tagging 34/100');
  expect(html).toContain('Usable summary');
});
it('labels a growing import total without claiming the whole mailbox has been counted', () => {
  const query = mocks.query();
  mocks.query.mockReturnValue({
    ...query,
    data: {
      ...query.data,
      processing: { imported: 20, tagged: 20, remaining: 0, importing: true, paused: false },
    },
  });
  const html = renderToStaticMarkup(React.createElement(InboxView));
  expect(html).toContain('Importing mail');
  expect(html).toContain('20 imported');
});
