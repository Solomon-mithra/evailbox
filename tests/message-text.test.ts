import { afterEach, expect, it, vi } from 'vitest';
import { fetchMessageText } from '../src/lib/providers/content';

afterEach(() => vi.unstubAllGlobals());
const encoded = (value: string) => Buffer.from(value).toString('base64url');
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

it('reads the Gmail plain-text part live for classification, excluding attachments', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    response({
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: encoded('Interview on Tuesday') } },
              { mimeType: 'text/html', body: { data: encoded('<p>Interview on Tuesday</p>') } },
            ],
          },
          { mimeType: 'text/plain', filename: 'notes.txt', body: { data: encoded('Ignore') } },
        ],
      },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchMessageText('GMAIL', 'token', 'message/1')).toBe('Interview on Tuesday');
  expect(String(fetcher.mock.calls[0][0])).toBe(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/message%2F1?format=full',
  );
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
});

it('returns null when a Gmail message has no plain-text part', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response({ payload: { mimeType: 'text/html', body: { data: encoded('<p>Hi</p>') } } }),
      ),
  );
  expect(await fetchMessageText('GMAIL', 'token', 'message')).toBeNull();
});

it('requests the Outlook body as text and bounds its length', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(response({ body: { contentType: 'text', content: 'x'.repeat(70000) } }));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchMessageText('OUTLOOK', 'token', 'AAMk=')).toHaveLength(64000);
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe('https://graph.microsoft.com/v1.0/me/messages/AAMk%3D?$select=body');
  expect(init.headers.Prefer).toContain('outlook.body-content-type="text"');
  expect(init.headers.Prefer).toContain('IdType="ImmutableId"');
});
