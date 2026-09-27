import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMessageContent } from '../src/lib/providers/content';
import { messageDocument, messageHeaders } from '../src/lib/email-document';

afterEach(() => vi.unstubAllGlobals());
const encoded = (value: string) => Buffer.from(value).toString('base64url');
function response(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}

describe('full message content', () => {
  it('prefers nested HTML over the plain alternative and excludes attached emails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          payload: {
            mimeType: 'multipart/mixed',
            parts: [
              {
                mimeType: 'multipart/alternative',
                parts: [
                  { mimeType: 'text/plain', body: { data: encoded('Preview only') } },
                  { mimeType: 'text/html', body: { data: encoded('<h1>Full newsletter ✓</h1>') } },
                ],
              },
              {
                mimeType: 'text/html',
                filename: 'attachment.html',
                body: { data: encoded('Ignore attachment') },
              },
            ],
          },
        }),
      ),
    );
    expect(await fetchMessageContent('GMAIL', 'token', 'message')).toEqual({
      format: 'html',
      content: '<h1>Full newsletter ✓</h1>',
    });
  });

  it('loads a Gmail body stored by attachment ID and decodes its declared charset', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          payload: {
            mimeType: 'text/html',
            headers: [{ name: 'Content-Type', value: 'text/html; charset=iso-8859-1' }],
            body: { attachmentId: 'body-id', size: 4 },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({ data: Buffer.from([99, 97, 102, 233]).toString('base64url') }),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchMessageContent('GMAIL', 'token', 'message')).toEqual({
      format: 'html',
      content: 'café',
    });
    expect(fetcher.mock.calls[1][0]).toContain('/messages/message/attachments/body-id');
  });

  it('requests Outlook HTML with immutable message IDs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({ body: { contentType: 'html', content: '<p>Full message</p>' } }),
      );
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchMessageContent('OUTLOOK', 'token', 'message/id')).toEqual({
      format: 'html',
      content: '<p>Full message</p>',
    });
    expect(fetcher.mock.calls[0][0]).toContain('message%2Fid');
    expect(fetcher.mock.calls[0][1].headers.Prefer).toContain('outlook.body-content-type="html"');
  });
});

describe('isolated email document', () => {
  it('carries its resource and referrer policy when rendered from the memory cache', () => {
    const document = messageDocument({ format: 'html', content: '<p>Message</p>' }, true);
    expect(document).toContain('http-equiv="Content-Security-Policy"');
    expect(document).toContain('script-src &#39;none&#39;');
    expect(document).toContain('img-src data: https:');
    expect(document).toContain('name="referrer" content="no-referrer"');
    expect(document.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(
      document.indexOf('<style>'),
    );
  });
  it('fits oversized newsletter tables and removes hidden document metadata', () => {
    const document = messageDocument({
      format: 'html',
      content:
        '<head><title>Hidden title</title></head><table width="1772"><tr><td>Newsletter</td></tr></table>',
    });
    expect(document).not.toContain('Hidden title');
    expect(document).toContain('width="100%"');
    expect(document).toContain('table-layout:fixed');
    expect(document).toContain('Newsletter');
  });
  it('retains newsletter structure but removes executable and tracking content by default', () => {
    const document = messageDocument(
      {
        format: 'html',
        content: `<script>alert(1)</script>
      <form action="/api/delete"><input name="x"></form><iframe src="/inbox"></iframe>
      <table><tr><td style="color:#123456;background-image:url(https://tracker.test/pixel);position:fixed" onclick="alert(1)">
      <h2>Newsletter</h2><a href="javascript:alert(1)">bad</a>
      <a href="https://example.com/story">Read story</a><img src="https://tracker.test/pixel" alt="Magazine cover"></td></tr></table>`,
      },
      false,
    );
    expect(document).toContain('<table>');
    expect(document).toContain('<h2>Newsletter</h2>');
    expect(document).toContain('color:#123456');
    expect(document).toContain('target="_blank"');
    expect(document).not.toMatch(
      /<script|<form|<input|<iframe|onclick|javascript:|background-image|position:fixed|https:\/\/tracker/,
    );
    expect(document).toContain('Magazine cover');
    expect(messageHeaders(false)['Content-Security-Policy']).toContain('img-src data:');
    expect(messageHeaders(false)['Content-Security-Policy']).toContain("script-src 'none'");
    expect(messageHeaders(false)['Cache-Control']).toContain('no-store');
  });

  it('allows external images only after opt-in and never permits relative app URLs', () => {
    const document = messageDocument(
      {
        format: 'html',
        content:
          '<img src="https://example.com/cover.png"><img src="/api/action"><a href="/api/auth/signout">bad</a>',
      },
      true,
    );
    expect(document).toContain('src="https://example.com/cover.png"');
    expect(document).not.toContain('/api/');
    expect(messageHeaders(true)['Content-Security-Policy']).toContain('img-src data: https:');
    expect(messageHeaders(true)['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('escapes plain text and labels a cached preview when the full message is unavailable', () => {
    const document = messageDocument(
      { format: 'text', content: '<script>literal</script>\nSecond line' },
      false,
      true,
    );
    expect(document).toContain('&lt;script&gt;literal&lt;/script&gt;');
    expect(document).toContain('Second line');
    expect(document).toContain('couldn’t load');
  });
});
