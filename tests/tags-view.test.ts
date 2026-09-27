import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  run: undefined as undefined | (() => Promise<void>),
  toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: m.toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useFetch', () => ({
  useAction: () => ({ mutateAsync: m.mutate, isPending: false }),
  useWorkspace: () => ({
    metadataReady: true,
    data: {
      tags: [
        {
          id: 'bank',
          name: 'Bank',
          description: 'Banking',
          prompt: 'Banking emails',
          priority: 'HIGH',
          keywords: [],
          senders: [],
          version: 1,
        },
      ],
      emails: [],
      total: 0,
    },
  }),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => Promise<void> }) => {
    if (React.Children.toArray(children).includes('Check for matches')) m.run = onClick;
    return React.createElement('button', {}, children);
  },
}));
vi.mock('@/components/tag-form', () => ({ TagForm: () => null }));
vi.mock('@/components/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/email-detail', () => ({ EmailDetail: () => null }));
import { TagsView } from '@/components/tags-view';
vi.stubGlobal('React', React);
beforeEach(() => {
  vi.clearAllMocks();
  m.run = undefined;
});
async function check(response: Record<string, unknown>) {
  m.mutate.mockResolvedValue(response);
  renderToStaticMarkup(React.createElement(TagsView, { tagId: 'bank' }));
  expect(m.run).toBeTypeOf('function');
  await m.run!();
}
it('acknowledges queued Bank checks without claiming they have completed', async () => {
  await check({ queued: true, pending: true, workerAvailable: true });
  expect(m.mutate).toHaveBeenCalledWith({ path: '/api/classify/batch', body: { tagId: 'bank' } });
  expect(m.toast.info).toHaveBeenCalledWith(
    'Checking up to 100 unprocessed emails for matches. Results will appear automatically.',
  );
  expect(m.toast.success).not.toHaveBeenCalled();
  expect(JSON.stringify(m.toast.info.mock.calls)).not.toMatch(/undefined|Completed/);
});
it('explains deferred checks when the worker is unavailable', async () => {
  await check({ queued: true, pending: true, workerAvailable: false });
  expect(m.toast.warning).toHaveBeenCalledWith(
    'Your check is saved and will start when background processing is available.',
  );
  expect(m.toast.success).not.toHaveBeenCalled();
});
it('keeps demo feedback separate from live queued work', async () => {
  await check({ demo: true });
  expect(m.toast.success).toHaveBeenCalledWith('Demo emails checked against your tags.');
  expect(m.toast.info).not.toHaveBeenCalled();
});
it('never claims completion for an unexpected response', async () => {
  await check({});
  expect(m.toast.error).toHaveBeenCalled();
  expect(m.toast.success).not.toHaveBeenCalled();
});
