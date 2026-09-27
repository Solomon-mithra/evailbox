import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Email } from '@/types';
import { emailContentQuery, emailThreadQuery } from '@/lib/email-preload';
import { messageDocument } from '@/lib/email-document';

vi.mock('@/hooks/useFetch', () => ({ useAction: () => ({ isPending: false }) }));
vi.mock('@/components/providers', () => ({
  useDemo: () => false,
  usePrivateCache: () => ({ user: { id: 'alice' }, ready: true }),
}));
vi.mock('@/components/workspace-selection', () => ({
  useWorkspaceSelection: () => ({ workspace: 'PERSONAL' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { EmailDetail } from '@/components/email-detail';
vi.stubGlobal('React', React);
const email = {
  id: 'mail',
  subject: 'Newsletter',
  sender: 'sender@example.com',
  senderName: 'Sender',
  receivedAt: new Date().toISOString(),
  classifications: [],
} as unknown as Email;
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
});

function render() {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(EmailDetail, { email, onClose: () => {} }),
    ),
  );
}
it('opens cached HTML in an isolated iframe with images already enabled', () => {
  client.setQueryData(
    emailContentQuery({ userId: 'alice', workspace: 'PERSONAL' }, 'mail').queryKey,
    {
      html: messageDocument(
        {
          format: 'html',
          content: '<h2>Cached newsletter</h2><img src="https://images.example/cover.png">',
        },
        true,
      ),
      fallback: false,
    },
  );
  const html = render();
  expect(html).toContain('srcDoc=');
  expect(html).toContain('Cached newsletter');
  expect(html).toContain('https://images.example/cover.png');
  expect(html).toContain('Hide images');
  expect(html).toContain('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"');
  expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).not.toContain('/content?');
});
it('renders an in-page reader with a back action instead of a modal', () => {
  const html = render();
  expect(html).toContain('Back to inbox');
  expect(html).toContain('<h1');
  expect(html).toContain('Newsletter');
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain('dialog-overlay');
});
it('shows received and sent replies in conversation order', () => {
  const messages = [
    {
      id: 'original',
      sender: 'sender@example.com',
      senderName: 'Sender',
      receivedAt: '2026-09-25T09:00:00Z',
      current: true,
      fallback: false,
      html: '<p>Original message text</p>',
    },
    {
      id: 'sent',
      sender: 'alice@example.com',
      senderName: 'Alice',
      receivedAt: '2026-09-25T10:00:00Z',
      current: false,
      fallback: false,
      html: '<p>Earlier reply from me</p>',
    },
    {
      id: 'reply',
      sender: 'sender@example.com',
      senderName: 'Sender',
      receivedAt: '2026-09-25T11:00:00Z',
      current: false,
      fallback: false,
      html: '<p>The follow-up response</p>',
    },
  ];
  client.setQueryData(
    emailThreadQuery({ userId: 'alice', workspace: 'PERSONAL' }, 'mail').queryKey,
    { messages, partial: false },
  );
  const html = render();
  expect(html).toContain('Original message text');
  expect(html).toContain('Earlier reply from me');
  expect(html).toContain('The follow-up response');
  expect(html.indexOf('Original message text')).toBeLessThan(html.indexOf('Earlier reply from me'));
  expect(html.indexOf('Earlier reply from me')).toBeLessThan(
    html.indexOf('The follow-up response'),
  );
  expect(html.indexOf('aria-label="Reply to Sender"')).toBeLessThan(
    html.indexOf('Earlier reply from me'),
  );
  expect(html).toContain('alice@example.com');
  expect(html).not.toContain('email-message-placeholder');
});
it('keeps the complete selected message when the thread only has its preview', () => {
  const scope = { userId: 'alice', workspace: 'PERSONAL' as const };
  client.setQueryData(emailContentQuery(scope, 'mail').queryKey, {
    html: '<p>Complete cached selected message</p>',
    fallback: false,
  });
  client.setQueryData(emailThreadQuery(scope, 'mail').queryKey, {
    messages: [{ ...email, current: true, fallback: true, html: '<p>Only a snippet</p>' }],
    partial: true,
  });
  const html = render();
  expect(html).toContain('Complete cached selected message');
  expect(html).not.toContain('Only a snippet');
  expect(html).toContain('Try again');
});
it('keeps the reader space stable while an uncached message loads', () => {
  const html = render();
  expect(html).toContain('email-message-placeholder');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('<iframe');
});
