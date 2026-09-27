import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EmailMessageFrame, readEmailFrameHeight } from '@/components/email-message-frame';

vi.stubGlobal('React', React);

describe('email frame height messages', () => {
  const frameWindow = {} as Window;
  const message = (height: unknown, source: Window | null = frameWindow) => ({
    source,
    data: { type: 'evailbox:email-height', height },
  });

  it('accepts height only from the mounted frame window', () => {
    expect(readEmailFrameHeight(message(412.2), frameWindow)).toBe(413);
    expect(readEmailFrameHeight(message(412, {} as Window), frameWindow)).toBeNull();
    expect(readEmailFrameHeight(message(412, null), null)).toBeNull();
  });

  it.each([null, '400', NaN, Infinity, -Infinity, -3, 0, {}, []])(
    'rejects invalid height %s',
    (height) => {
      expect(readEmailFrameHeight(message(height), frameWindow)).toBeNull();
    },
  );

  it.each([null, 320, [], { type: 'another-message', height: 400 }, { height: 400 }])(
    'rejects an unrelated message shape %s',
    (data) => {
      expect(readEmailFrameHeight({ source: frameWindow, data }, frameWindow)).toBeNull();
    },
  );

  it('keeps empty and unusually long messages within usable bounds', () => {
    expect(readEmailFrameHeight(message(1), frameWindow)).toBe(48);
    expect(readEmailFrameHeight(message(1_000_000), frameWindow)).toBe(24_000);
  });
});

it('renders a scrolling fallback and permits sizing while keeping the frame origin opaque', () => {
  const html = renderToStaticMarkup(
    React.createElement(EmailMessageFrame, { html: '<p>Message</p>' }),
  );
  expect(html).toContain('title="Email message"');
  expect(html).toContain('class="email-message-frame"');
  expect(html).toContain('srcDoc="&lt;p&gt;Message&lt;/p&gt;"');
  expect(html).toContain('style="height:320px"');
  expect(html).toContain('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"');
  expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).not.toContain('scrolling="no"');
});
