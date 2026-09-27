import { expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    title: string;
    description: string;
    children: React.ReactNode;
  }) =>
    open ? React.createElement('section', { role: 'dialog' }, title, description, children) : null,
}));
import { ConnectAccountDialog } from '@/components/connect-account-dialog';
vi.stubGlobal('React', React);

it('stays closed until a provider is selected', () => {
  const html = renderToStaticMarkup(
    React.createElement(ConnectAccountDialog, {
      provider: null,
      workspace: 'PERSONAL',
      workspaceName: 'Personal',
      onClose: () => {},
    }),
  );
  expect(html).toBe('');
});

it.each([
  ['GMAIL', 'gmail', 'Gmail'],
  ['OUTLOOK', 'outlook', 'Outlook'],
] as const)(
  'offers an explicit scoped continuation for %s after explaining the import',
  (provider, path, label) => {
    const html = renderToStaticMarkup(
      React.createElement(ConnectAccountDialog, {
        provider,
        workspace: 'WORK',
        workspaceName: 'Work',
        onClose: () => {},
      }),
    );
    expect(html).toContain(`href="/api/accounts/${path}/auth?workspace=WORK"`);
    expect(html).toContain(`Continue with ${label}`);
    expect(html).toContain('up to 100');
    expect(html).toContain('most recent inbox emails');
    expect(html).toContain('automatically processed and classified');
    expect(html).toContain('tag rules');
    expect(html).toContain('Work workspace');
    expect(html).toContain('Cancel');
  },
);
