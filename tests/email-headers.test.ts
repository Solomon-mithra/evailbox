import { describe, expect, it } from 'vitest';
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import nextConfig from '../next.config';
import { messageHeaders } from '../src/lib/email-document';

describe('email frame security headers', () => {
  it('leaves the email route policy intact instead of overriding it with frame denial', async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: 'http://localhost:3000/api/emails/message/content?images=1',
      nextConfig,
    });
    expect(response.headers.has('Content-Security-Policy')).toBe(false);
    expect(response.headers.has('X-Frame-Options')).toBe(false);
    const policy = messageHeaders(true)['Content-Security-Policy'];
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain('sandbox allow-popups allow-popups-to-escape-sandbox');
    expect(policy).not.toContain('allow-same-origin');
  });

  it.each(['/', '/inbox', '/api/emails/message', '/api/emails/message/content/extra'])(
    'retains frame denial on %s',
    async (path) => {
      const response = await unstable_getResponseFromNextConfig({
        url: `http://localhost:3000${path}`,
        nextConfig,
      });
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    },
  );
});
