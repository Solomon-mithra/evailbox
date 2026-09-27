import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReplyEditor, type ReplyEditorState } from '@/components/reply-editor';

vi.stubGlobal('React', React);
const actions = {
  changeBody: vi.fn(),
  changeMode: vi.fn(),
  send: vi.fn(),
  save: vi.fn(),
  newReply: vi.fn(),
  reconcile: vi.fn(),
  reload: vi.fn(),
  loadRecipients: vi.fn(),
};
let state: ReplyEditorState;
beforeEach(() => {
  state = {
    emailId: 'mail',
    body: 'My reply',
    mode: 'reply',
    draft: null,
    accountEmail: 'me@example.com',
    context: { from: 'me@example.com', to: ['sender@example.com'], cc: [], subject: 'Re: Hello' },
    contextBusy: false,
    loaded: true,
    saveState: 'unsaved',
    busy: null,
    error: '',
    notice: null,
    demo: false,
  };
});
const render = () => renderToStaticMarkup(React.createElement(ReplyEditor, { state, actions }));

it('allows writing and saving while provider recipients load, but prevents sending', () => {
  state.context = null;
  state.contextBusy = true;
  const html = render();
  expect(html).toContain('Save draft');
  expect(html.match(/<textarea[^>]*>/)?.[0]).not.toContain('disabled');
  expect(html.match(/<button[^>]*data-action="save"[^>]*>/)?.[0]).not.toContain('disabled');
  expect(html.match(/<button[^>]*data-action="send"[^>]*>/)?.[0]).toContain('disabled');
  expect(html).toContain('Loading recipients');
});

it('replaces accepted editors with confirmation and a fresh-reply action', () => {
  state.draft = {
    id: 'sent',
    body: 'My reply',
    mode: 'reply',
    revision: 4,
    status: 'accepted',
    updatedAt: '',
    acceptedAt: '',
    lastError: null,
  };
  const html = render();
  expect(html).toContain('Reply sent');
  expect(html).toContain('Reply again');
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('Draft saved');
  expect(html).not.toContain('Save draft');
});

it('keeps uncertain sends reviewable without offering another send or a new reply', () => {
  state.draft = {
    id: 'uncertain',
    body: 'My reply',
    mode: 'reply',
    revision: 4,
    status: 'unknown',
    updatedAt: '',
    acceptedAt: null,
    lastError: 'Check your mailbox.',
  };
  const html = render();
  expect(html).toContain('Check send status');
  expect(html).toContain('readOnly');
  expect(html).not.toContain('data-action="send"');
  expect(html).not.toContain('Reply again');
});

it('describes explicit saving as saving, never sending', () => {
  state.busy = 'save';
  state.saveState = 'saving';
  const html = render();
  expect(html).toContain('Saving…');
  expect(html).not.toContain('Sending…');
});

it('keeps an opening-draft failure distinct from a save failure', () => {
  state.loaded = false;
  state.error = 'Could not open draft';
  state.saveState = 'error';
  const html = render();
  expect(html).toContain('Try again');
  expect(html.match(/<textarea[^>]*>/)?.[0]).toContain('disabled');
  expect(html).not.toContain('Reopen saved draft');
});

it('offers explicit recovery for saved-draft conflicts without silently replacing the text', () => {
  state.saveState = 'error';
  state.error = 'This draft changed in another tab.';
  expect(render()).toContain('Reopen saved draft');
  state.saveState = 'loading';
  expect(render().match(/<textarea[^>]*>/)?.[0]).toContain('disabled');
  expect(render().match(/<button[^>]*data-action="send"[^>]*>/)?.[0]).toContain('disabled');
});

it('locks stale reply text until the user explicitly opens the current draft', () => {
  state.staleDraft = true;
  const html = render();
  expect(html).toContain('Open current draft');
  expect(html).toContain('readOnly');
  expect(html).not.toContain('data-action="send"');
});

it('can recover when starting another reply succeeds remotely but loses its response', () => {
  state.draft = {
    id: 'sent',
    body: 'My reply',
    mode: 'reply',
    revision: 4,
    status: 'accepted',
    updatedAt: '',
    acceptedAt: '',
    lastError: null,
  };
  state.error = 'Could not connect';
  expect(render()).toContain('Open current draft');
});
