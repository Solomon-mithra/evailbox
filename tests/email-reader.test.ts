import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Email } from '@/types';
import { emailContentQuery } from '@/lib/email-preload';
import { messageDocument } from '@/lib/email-document';

vi.mock('@/hooks/useFetch', () => ({ useAction: () => ({ isPending: false }) }));
vi.mock('@/components/providers', () => ({
  useDemo: () => false,
  usePrivateCache: () => ({ user: { id: 'alice' }, ready: true }),
}));
vi.mock('@/components/workspace-selection', () => ({
  useWorkspaceSelection: () => ({ workspace: 'PERSONAL' }),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
}));
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
  expect(html).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
  expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).not.toContain('allow-scripts');
  expect(html).not.toContain('allow-same-origin');
  expect(html).not.toContain('/content?');
});
it('keeps the reader space stable while an uncached message loads', () => {
  const html = render();
  expect(html).toContain('email-message-placeholder');
  expect(html).toContain('role="status"');
  expect(html).not.toContain('<iframe');
});
